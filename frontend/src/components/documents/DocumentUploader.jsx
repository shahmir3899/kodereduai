import { useEffect, useRef, useState } from 'react'
import ImageAdjustModal from './ImageAdjustModal'
import Spinner from '../ui/Spinner'
import Badge from '../ui/Badge'
import { compressImageForUpload } from '../../utils/compressImageForUpload'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT_FILES = 'image/jpeg,image/png,image/webp,application/pdf,.doc,.docx'

const STATUS = {
  ready: { tone: 'neutral', label: 'Ready' },
  uploading: { tone: 'info', label: 'Uploading' },
  duplicate: { tone: 'warning', label: 'Already on file, not kept' },
  failed: { tone: 'danger', label: 'Failed' },
}

let nextId = 1

/**
 * The only thing a user does to add documents: take photos or choose files, optionally
 * rotate/crop each photo, and send. Photos are compressed in the browser first. The
 * record behind each file is filled in by the server from the image.
 *
 * upload(file) must resolve to { duplicate, document } (the scan endpoints' shape).
 * onSettled() runs once after a batch so the page can reload its list.
 */
export default function DocumentUploader({ upload, onSettled, disabled = false, disabledHint = '' }) {
  const [items, setItems] = useState([])
  const [adjusting, setAdjusting] = useState(null)
  const [sending, setSending] = useState(false)
  const [summary, setSummary] = useState('')
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), [])

  const patch = (id, change) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...change } : i)))

  const add = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // so the same file can be chosen again
    setSummary('')
    setItems((prev) => [
      ...prev,
      ...files.map((file) => {
        const isImage = file.type.startsWith('image/')
        const tooBig = file.size > MAX_BYTES && !isImage // photos are shrunk before sending
        return {
          id: nextId++, file, isImage,
          preview: isImage ? URL.createObjectURL(file) : '',
          status: tooBig ? 'failed' : 'ready',
          message: tooBig ? 'Larger than 10 MB' : '',
        }
      }),
    ])
  }

  const remove = (item) => {
    if (item.preview) URL.revokeObjectURL(item.preview)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  const adjusted = (file) => {
    const item = adjusting
    setAdjusting(null)
    if (item.preview) URL.revokeObjectURL(item.preview)
    patch(item.id, { file, preview: URL.createObjectURL(file) })
  }

  const sendAll = async () => {
    const ready = itemsRef.current.filter((i) => i.status === 'ready')
    if (!ready.length) return
    setSending(true)
    let saved = 0
    let duplicates = 0
    let failed = 0
    // One at a time: each upload is also a text-reading job on the server.
    for (const item of ready) {
      patch(item.id, { status: 'uploading', message: '' })
      try {
        const file = item.isImage ? await compressImageForUpload(item.file) : item.file
        const { data } = await upload(file)
        if (data?.duplicate) {
          duplicates += 1
          patch(item.id, { status: 'duplicate' })
        } else {
          saved += 1
          if (item.preview) URL.revokeObjectURL(item.preview)
          setItems((prev) => prev.filter((i) => i.id !== item.id))
        }
      } catch (err) {
        failed += 1
        patch(item.id, { status: 'failed', message: err?.response?.data?.error || err?.response?.data?.detail || 'Upload failed' })
      }
    }
    setSending(false)
    setSummary([
      saved && `${saved} saved`,
      duplicates && `${duplicates} already on file (not kept)`,
      failed && `${failed} failed`,
    ].filter(Boolean).join(', '))
    onSettled?.()
  }

  const readyCount = items.filter((i) => i.status === 'ready').length
  const blocked = disabled || sending
  const pickClass = `px-4 py-2 text-sm rounded-lg border ${blocked ? 'opacity-50 cursor-not-allowed border-gray-200 text-gray-400' : 'cursor-pointer border-primary-300 text-primary-700 hover:bg-primary-50'}`

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2">
        <label className={pickClass}>
          Take photo
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={add} disabled={blocked} />
        </label>
        <label className={pickClass}>
          Choose files
          <input type="file" accept={ACCEPT_FILES} multiple className="hidden" onChange={add} disabled={blocked} />
        </label>
        {readyCount > 0 && (
          <button type="button" onClick={sendAll} disabled={blocked} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
            {sending ? 'Uploading…' : `Upload ${readyCount} ${readyCount === 1 ? 'file' : 'files'}`}
          </button>
        )}
        {sending && <Spinner size="sm" />}
      </div>
      <p className="text-xs text-gray-500 mt-2">
        {disabled && disabledHint ? disabledHint : 'Photos, PDF or Word, up to 10 MB each. The details are read from each photo automatically.'}
      </p>
      {summary && <p className="text-sm text-gray-700 mt-2" role="status">{summary}</p>}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2">
              {item.preview
                ? <img src={item.preview} alt="" className="w-12 h-12 object-cover rounded border border-gray-200 flex-shrink-0" />
                : <div className="w-12 h-12 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-[10px] text-gray-500 flex-shrink-0">FILE</div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 truncate">{item.file.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                  {item.message && <span className="text-xs text-red-600">{item.message}</span>}
                </div>
              </div>
              {item.status === 'ready' && item.isImage && !sending && (
                <button type="button" onClick={() => setAdjusting(item)} className="text-xs text-primary-600 hover:underline">Rotate / crop</button>
              )}
              {item.status !== 'uploading' && (
                <button type="button" onClick={() => remove(item)} className="text-xs text-gray-500 hover:underline">Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adjusting && <ImageAdjustModal file={adjusting.file} onCancel={() => setAdjusting(null)} onDone={adjusted} />}
    </div>
  )
}
