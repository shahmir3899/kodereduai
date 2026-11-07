import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
// useToast() is the pattern that works in this app: the default export of Toast is a
// provider, not a displayable component.
import { useToast } from '../../components/Toast'
import PaperStructureBuilder, { calculateAllocatedMarks } from './PaperStructureBuilder'
import { QUESTION_TYPES } from './QuestionBankPicker'
import { useAuth } from '../../contexts/AuthContext'
import Spinner from '../../components/ui/Spinner'
import {
  MAX_PAGES,
  UPLOAD_CONCURRENCY,
  buildReview,
  changeQuestionType,
  missingBeforeSave,
  newGroupId,
  pageDisplayStatus,
  snippet,
} from './paperCaptureLogic'

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

const REVIEW_STEPS = [
  { id: 1, label: 'Questions' },
  { id: 2, label: 'Sections' },
  { id: 3, label: 'Details & accept' },
]

/**
 * ImageCapturePaperTab - "Capture from image" source for wizard Step 3, in the order the
 * data actually arrives: (1) say how many pages the paper has, (2) upload them -- all
 * pages are read at the same time, (3) review what was read: the questions and their
 * types first, then the sections derived from them, then the paper details. Class,
 * subject and marks that could not be found are asked for before anything is saved.
 * The page count is declared up front so the paper is known to be complete (or not).
 */
export default function ImageCapturePaperTab({ classId, subjectId, readOnly = false, onApplyPrefill }) {
  const { activeSchool, user } = useAuth()
  const { showError } = useToast()
  const recoveryKey = `paper_builder_image_capture_${activeSchool?.id || 'school'}_${user?.id || 'user'}`

  const [totalPages, setTotalPages] = useState(null)
  const [pageCountInput, setPageCountInput] = useState('1')
  const [groupId, setGroupId] = useState(null)
  // What this browser is doing with each page before the server owns it:
  // { [pageNumber]: { state: 'queued'|'uploading'|'failed', preview, error } }
  const [locals, setLocals] = useState({})
  const [review, setReview] = useState(null) // { header, structure, questions, paperFields, meta }
  const [reviewStep, setReviewStep] = useState(1)

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
    setReview(null)
    setReviewStep(1)
  }

  const anyLocalInFlight = Object.values(locals).some((l) => l.state === 'queued' || l.state === 'uploading')

  const { data: statusResponse, refetch } = useQuery({
    queryKey: ['paperGroupStatus', groupId, totalPages],
    queryFn: () => questionPaperApi.getPaperGroupStatus(groupId, totalPages),
    enabled: !!groupId && !!totalPages && !review,
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

  // Every declared page read: reconcile result becomes the editable review (once).
  useEffect(() => {
    if (reviewStartedRef.current || !groupStatus?.complete || !groupStatus.result) return
    reviewStartedRef.current = true
    const built = buildReview(groupStatus.result)
    setReview({
      ...built,
      meta: {
        marksCheck: groupStatus.result.marks_check,
        lowConfidence: groupStatus.result.low_confidence_count,
        uploadIds: groupStatus.pages.map((p) => p.upload_id).filter(Boolean),
      },
    })
    setReviewStep(1)
  }, [groupStatus])

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

      import('compressorjs')
        .then(({ default: Compressor }) => {
          new Compressor(file, {
            quality: 0.8,
            maxWidth: 2000,
            maxHeight: 2000,
            mimeType: 'image/jpeg',
            success: (result) => send(new File([result], file.name, { type: 'image/jpeg' })),
            error: () => {
              patchLocal(pageNumber, { state: 'failed', error: 'Could not prepare this image' })
              activeCountRef.current -= 1
              showError('Error compressing image')
              pump()
            },
          })
        })
        .catch(() => {
          patchLocal(pageNumber, { state: 'failed', error: 'Could not prepare this image' })
          activeCountRef.current -= 1
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

  // ---- review ----
  const setPaperField = (field, value) => setReview((prev) => ({ ...prev, paperFields: { ...prev.paperFields, [field]: value } }))

  const onTypeChange = (localId, type) => {
    setReview((prev) => ({ ...prev, ...changeQuestionType(prev.structure, prev.questions, localId, type) }))
  }

  const lowConfidenceLeft = review ? review.questions.filter((q) => q.needs_review).length : 0
  const missing = review ? missingBeforeSave({ paperFields: review.paperFields }) : []

  const handleAccept = () => {
    if (!review || missing.length > 0) return
    localStorage.removeItem(recoveryKey)
    onApplyPrefill?.({
      uploadId: review.meta.uploadIds[review.meta.uploadIds.length - 1],
      uploadIds: review.meta.uploadIds,
      paperFields: review.paperFields,
      // Not found on the paper: the builder asks for these before anything is saved.
      detected: { class_label: review.header.class_label || '', subject_label: review.header.subject_label || '' },
      structure: review.structure,
      questions: review.questions.map(({ needs_review: _flag, ...question }) => question),
    })
  }

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

  if (!review) {
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

  const capturedMarks = calculateAllocatedMarks(review.structure)
  const detectedTotal = Number(review.paperFields.total_marks) || null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {REVIEW_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => setReviewStep(step.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${reviewStep === step.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            {step.id}. {step.label}
          </button>
        ))}
        <button type="button" onClick={startOver} className="ml-auto text-sm text-gray-600 hover:text-gray-800 underline">Start over</button>
      </div>

      {reviewStep === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {review.questions.length} question{review.questions.length === 1 ? '' : 's'} read from {totalPages} page{totalPages === 1 ? '' : 's'}, in paper order.
            {lowConfidenceLeft > 0
              ? ` ${lowConfidenceLeft} to check — the type below was a guess.`
              : ' Check each type; the sections are built from them.'}
          </p>
          <ol className="space-y-2">
            {review.questions.map((q, i) => (
              <li
                key={q.local_id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border ${q.needs_review ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
              >
                <span className="text-sm text-gray-500 w-8 shrink-0">{i + 1}.</span>
                <span className="flex-1 min-w-0 text-sm text-gray-800">{snippet(q.question_text) || <em className="text-gray-400">No text read</em>}</span>
                <span className="text-xs text-gray-500 shrink-0">{q.marks} mark{Number(q.marks) === 1 ? '' : 's'}</span>
                <select
                  aria-label={`Type of question ${i + 1}`}
                  value={q.question_type}
                  onChange={(e) => onTypeChange(q.local_id, e.target.value)}
                  className="input w-full sm:w-44 shrink-0"
                >
                  {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {q.needs_review && <span className="text-xs text-amber-800 shrink-0">Check type</span>}
              </li>
            ))}
          </ol>
          <div className="flex justify-end">
            <button type="button" onClick={() => setReviewStep(2)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Next: sections</button>
          </div>
        </div>
      )}

      {reviewStep === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Sections were built from the question types{review.structure.some((s) => s.title) ? ' and the headings on the paper' : ''}.
            A section that ran across a page break is already joined. Adjust titles, counts and marks if needed.
          </p>
          <PaperStructureBuilder
            sections={review.structure}
            onChange={(next) => setReview((prev) => ({ ...prev, structure: next }))}
            totalMarks={review.paperFields.total_marks}
          />
          <div className="flex justify-between">
            <button type="button" onClick={() => setReviewStep(1)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100">Back</button>
            <button type="button" onClick={() => setReviewStep(3)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Next: details</button>
          </div>
        </div>
      )}

      {reviewStep === 3 && (
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <h4 className="font-semibold text-gray-800">Paper details</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm text-gray-700">Paper title *
                <input type="text" value={review.paperFields.paper_title} onChange={(e) => setPaperField('paper_title', e.target.value)} className="input w-full mt-1" />
              </label>
              <label className="text-sm text-gray-700">Total marks *
                <input type="number" value={review.paperFields.total_marks} onChange={(e) => setPaperField('total_marks', e.target.value)} className="input w-full mt-1" />
              </label>
              <label className="text-sm text-gray-700">Duration (minutes)
                <input type="number" value={review.paperFields.duration_minutes} onChange={(e) => setPaperField('duration_minutes', e.target.value)} className="input w-full mt-1" />
              </label>
            </div>
            <p className="text-xs text-gray-600">
              Class on the paper: <strong>{review.header.class_label || 'not found'}</strong> · Subject: <strong>{review.header.subject_label || 'not found'}</strong>.
              {classId && subjectId
                ? ' Your Paper Setup selection is used.'
                : ' You will be asked to pick the class and subject next; nothing is saved before that.'}
            </p>
          </div>

          {detectedTotal && (
            <div className={`text-sm px-3 py-2 rounded-lg border ${capturedMarks === detectedTotal ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              {capturedMarks === detectedTotal
                ? `${capturedMarks} / ${detectedTotal} marks — the sections add up to the total.`
                : `The sections add up to ${capturedMarks} marks but the total is ${detectedTotal}. Check the counts and marks in step 2, or correct the total.`}
            </div>
          )}
          {lowConfidenceLeft > 0 && (
            <div className="text-sm px-3 py-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-800">
              {lowConfidenceLeft} question type(s) were guesses and are still unchecked (step 1). You can accept and fix them later.
            </div>
          )}
          {missing.length > 0 && (
            <div className="text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-800">
              Fill in before continuing: {missing.join(', ')}.
            </div>
          )}

          <div className="flex justify-between pt-2 border-t border-gray-200">
            <button type="button" onClick={() => setReviewStep(2)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100">Back</button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={missing.length > 0}
              className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Accept & continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
