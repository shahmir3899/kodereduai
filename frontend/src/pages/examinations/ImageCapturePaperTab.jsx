import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
// useToast() is the pattern that works in this app: the default export of Toast is a
// provider, not a displayable component.
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import Spinner from '../../components/ui/Spinner'
import { compressImageForUpload } from '../../utils/compressImageForUpload'
import BlockScanReview from './blocks/BlockScanReview'
import { MAX_PAGES, UPLOAD_CONCURRENCY, newGroupId, pageDisplayStatus } from './paperCaptureLogic'

const POLL_INTERVAL_MS = 2500

const SLOT_LABEL = {
  empty: 'Choose image',
  queued: 'Waiting to upload…',
  uploading: 'Uploading…',
  processing: 'Reading with OCR…',
  extracted: 'Read ✓',
  failed: 'Failed — choose image to retry',
}

const SLOT_TONE = {
  empty: 'border-gray-300 bg-white text-gray-600',
  queued: 'border-blue-200 bg-blue-50 text-blue-800',
  uploading: 'border-blue-200 bg-blue-50 text-blue-800',
  processing: 'border-blue-200 bg-blue-50 text-blue-800',
  extracted: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
}

/**
 * ImageCapturePaperTab - "From a photo of a paper" in the block editor (papers and worksheets), in the
 * order the data arrives: (1) say how many pages the paper has, (2) upload them -- all pages are read at
 * the same time, straight into blocks, (3) review the blocks beside the photo (BlockScanReview). The page
 * count is declared up front so the paper is known to be complete (or not). The old questions/sections
 * review was removed in Paper Builder v2 Phase 7.
 */
export default function ImageCapturePaperTab({ classId, subjectId, readOnly = false, onApplyPrefill }) {
  const { activeSchool, user } = useAuth()
  const { showError } = useToast()
  // The "_blocks" suffix is kept from when two scan modes existed, so a capture started before the
  // update still resumes after a reload.
  const recoveryKey = `paper_builder_image_capture_${activeSchool?.id || 'school'}_${user?.id || 'user'}_blocks`

  const [totalPages, setTotalPages] = useState(null)
  const [pageCountInput, setPageCountInput] = useState('1')
  const [groupId, setGroupId] = useState(null)
  // What this browser is doing with each page before the server owns it:
  // { [pageNumber]: { state: 'queued'|'uploading'|'failed', preview, error } }
  const [locals, setLocals] = useState({})
  const [blockReview, setBlockReview] = useState(null) // { result, pages, uploadIds }

  const queueRef = useRef([])
  const activeCountRef = useRef(0)
  const groupIdRef = useRef(null)
  const reviewStartedRef = useRef(false)

  // A reload mid-capture resumes from the server: only the group and page count are needed.
  useEffect(() => {
    if (readOnly) return
    try {
      const saved = JSON.parse(localStorage.getItem(recoveryKey) || 'null')
      if (saved?.groupId && saved?.totalPages) {
        setGroupId(saved.groupId)
        groupIdRef.current = saved.groupId
        setTotalPages(saved.totalPages)
      }
    } catch {
      // A corrupt snapshot is simply ignored.
    }
  }, [readOnly, recoveryKey])

  const startCapture = () => {
    const count = Math.max(1, Math.min(MAX_PAGES, parseInt(pageCountInput, 10) || 1))
    const id = newGroupId()
    setGroupId(id)
    groupIdRef.current = id
    setTotalPages(count)
    localStorage.setItem(recoveryKey, JSON.stringify({ groupId: id, totalPages: count }))
  }

  const startOver = () => {
    localStorage.removeItem(recoveryKey)
    queueRef.current = []
    reviewStartedRef.current = false
    setGroupId(null)
    groupIdRef.current = null
    setTotalPages(null)
    setLocals({})
    setBlockReview(null)
  }

  const anyLocalInFlight = Object.values(locals).some((l) => l.state === 'queued' || l.state === 'uploading')

  const { data: statusResponse, refetch } = useQuery({
    queryKey: ['paperGroupStatus', groupId, totalPages],
    queryFn: () => questionPaperApi.getPaperGroupStatus(groupId, totalPages),
    enabled: !!groupId && !!totalPages && !blockReview,
    refetchInterval: (query) => {
      const pages = query.state.data?.data?.pages || []
      const serverBusy = pages.some((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
      return serverBusy || anyLocalInFlight ? POLL_INTERVAL_MS : false
    },
  })
  const groupStatus = statusResponse?.data || null
  const serverByPage = useMemo(() => {
    const map = {}
    ;(groupStatus?.pages || []).forEach((p) => { map[p.page_number] = p })
    return map
  }, [groupStatus])

  // Every declared page read: the merged blocks become the review (once).
  useEffect(() => {
    if (reviewStartedRef.current || !groupStatus?.complete || !groupStatus.result) return
    reviewStartedRef.current = true
    setBlockReview({
      result: groupStatus.result,
      uploadIds: groupStatus.pages.map((p) => p.upload_id).filter(Boolean),
      pages: groupStatus.pages
        .filter((p) => p.image_url)
        .map((p) => ({ page_number: p.page_number, image_url: p.image_url })),
    })
  }, [groupStatus])
  // Complete with no result: pages read by the old scanner before the update (it no longer exists).
  const staleCapture = !!groupStatus?.complete && !groupStatus.result

  // ---- upload queue: pages go up together, a few at a time ----
  const patchLocal = useCallback((pageNumber, patch) => {
    setLocals((prev) => ({ ...prev, [pageNumber]: { ...(prev[pageNumber] || {}), ...patch } }))
  }, [])

  const pump = useCallback(() => {
    while (activeCountRef.current < UPLOAD_CONCURRENCY && queueRef.current.length > 0) {
      const { pageNumber, file } = queueRef.current.shift()
      activeCountRef.current += 1
      patchLocal(pageNumber, { state: 'uploading', error: '' })

      const send = (toUpload) => questionPaperApi
        .uploadPaperImage(toUpload, classId || null, subjectId || null, groupIdRef.current, pageNumber)
        .then(() => {
          // The server owns the page from here: drop the local state so its status shows.
          setLocals((prev) => {
            const { [pageNumber]: _done, ...rest } = prev
            return rest
          })
          refetch()
        })
        .catch((error) => {
          patchLocal(pageNumber, { state: 'failed', error: error?.response?.data?.detail || 'Upload failed' })
        })
        .finally(() => {
          activeCountRef.current -= 1
          pump()
        })

      // The shared uploader helper (also used by document uploads): 2000px, JPEG, EXIF stripped.
      compressImageForUpload(file)
        .then((compressed) => send(compressed))
        .catch(() => {
          patchLocal(pageNumber, { state: 'failed', error: 'Could not prepare this image' })
          activeCountRef.current -= 1
          showError('Error compressing image')
          pump()
        })
    }
  }, [classId, subjectId, patchLocal, refetch, showError])

  const enqueue = useCallback((pageNumber, file) => {
    if (!file || readOnly) return
    patchLocal(pageNumber, { state: 'queued', preview: URL.createObjectURL(file), error: '' })
    queueRef.current.push({ pageNumber, file })
    pump()
  }, [patchLocal, pump, readOnly])

  const slotStatus = useCallback((pageNumber) => pageDisplayStatus(locals[pageNumber], serverByPage[pageNumber]), [locals, serverByPage])

  // Several images at once fill the pages that still need one, in file-name order.
  const onBulkDrop = useCallback((files) => {
    const needing = []
    for (let n = 1; n <= (totalPages || 0); n += 1) {
      if (['empty', 'failed'].includes(slotStatus(n))) needing.push(n)
    }
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    sorted.slice(0, needing.length).forEach((file, i) => enqueue(needing[i], file))
    if (sorted.length > needing.length) showError(`Only ${needing.length} page(s) still need an image; extra images were ignored.`)
  }, [enqueue, showError, slotStatus, totalPages])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onBulkDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    maxSize: 10 * 1024 * 1024,
    multiple: true,
    noClick: true,
    disabled: readOnly,
  })

  // ---- render ----
  if (readOnly) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This paper is finalized and is opened in read-only mode.
      </div>
    )
  }

  if (!totalPages) {
    return (
      <div className="max-w-md mx-auto text-center space-y-4 py-8">
        <div className="text-4xl">📸</div>
        <h3 className="text-lg font-semibold text-gray-900">How many pages does the paper have?</h3>
        <p className="text-sm text-gray-600">
          Say the total up front so we know when the whole paper has been read. You can then add all the pages together.
        </p>
        <div className="flex items-center justify-center gap-3">
          <label htmlFor="paper-page-count" className="text-sm text-gray-700">Total pages</label>
          <input
            id="paper-page-count"
            type="number"
            min={1}
            max={MAX_PAGES}
            value={pageCountInput}
            onChange={(e) => setPageCountInput(e.target.value)}
            className="input w-24 text-center"
          />
          <button type="button" onClick={startCapture} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Continue
          </button>
        </div>
      </div>
    )
  }

  if (blockReview) {
    return (
      <BlockScanReview
        result={blockReview.result}
        pages={blockReview.pages}
        onStartOver={startOver}
        onAccept={(blocks) => {
          localStorage.removeItem(recoveryKey)
          onApplyPrefill?.({
            uploadId: blockReview.uploadIds[blockReview.uploadIds.length - 1],
            uploadIds: blockReview.uploadIds,
            header: blockReview.result.header || {},
            direction: blockReview.result.direction || 'ltr',
            blocks,
          })
        }}
      />
    )
  }

  if (staleCapture) {
    return (
      <div className="max-w-md mx-auto text-center space-y-3 py-8">
        <p className="text-sm text-gray-700">These pages were read by the old scanner, which has been replaced. Please scan them again.</p>
        <button type="button" onClick={startOver} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Start over</button>
      </div>
    )
  }

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
  const readCount = pageNumbers.filter((n) => slotStatus(n) === 'extracted').length
  const failedPages = pageNumbers.filter((n) => slotStatus(n) === 'failed')
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">
          <span className="font-medium">{readCount} of {totalPages}</span> page{totalPages === 1 ? '' : 's'} read
          {failedPages.length > 0 && <span className="text-red-700"> · {failedPages.length} failed</span>}
        </p>
        <button type="button" onClick={startOver} className="text-sm text-gray-600 hover:text-gray-800 underline">Start over</button>
      </div>

      <div
        {...getRootProps()}
        className={`rounded-lg border-2 border-dashed p-4 text-center text-sm ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
      >
        <input {...getInputProps()} aria-label="Add several page images" />
        Drop all page images here — they fill the empty pages in file-name order. Or choose each page below.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {pageNumbers.map((n) => {
          const status = slotStatus(n)
          const local = locals[n]
          const error = status === 'failed' ? (local?.error || serverByPage[n]?.error_message || 'Please try again with a clearer photo.') : ''
          const busy = ['queued', 'uploading', 'processing'].includes(status)
          return (
            <div key={n} className={`rounded-lg border p-3 text-center space-y-2 ${SLOT_TONE[status]}`}>
              <p className="font-semibold">Page {n}</p>
              {local?.preview && <img src={local.preview} alt={`Page ${n} preview`} className="h-24 mx-auto object-contain rounded" />}
              <p className="text-xs flex items-center justify-center gap-1">
                {busy && <Spinner size="sm" />}
                {SLOT_LABEL[status]}
              </p>
              {error && <p className="text-xs">{error}</p>}
              {!busy && status !== 'extracted' && (
                <input
                  type="file"
                  accept="image/*"
                  aria-label={`Page ${n} image`}
                  className="block w-full text-xs"
                  onChange={(e) => { enqueue(n, e.target.files?.[0]); e.target.value = '' }}
                />
              )}
            </div>
          )
        })}
      </div>

      {failedPages.length === 0 && readCount < totalPages && readCount + Object.keys(locals).length < totalPages && (
        <p className="text-xs text-gray-500">The review opens once all {totalPages} pages have been read.</p>
      )}
    </div>
  )
}
