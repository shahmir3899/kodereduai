import { useState } from 'react'
import Modal from '../ui/Modal'
import Field from '../ui/Field'
import Badge from '../ui/Badge'

export const isImageUrl = (url) => /\.(jpe?g|png|webp)$/i.test((url || '').split('?')[0])

export const SCAN_STATUS = {
  PENDING: { tone: 'info', label: 'Reading…' },
  NEEDS_REVIEW: { tone: 'warning', label: 'Needs review' },
}

/**
 * View and correct one document record next to its image. Shared by staff and student
 * documents: the page passes its own type list and says which extra fields it stores.
 *
 * onSave(payload) and onRescan() return promises; a rejected onSave shows its message.
 */
export default function DocumentEditModal({
  doc,
  typeOptions,
  qualificationTypes = [],
  withExpiry = true,
  withNotes = true,
  canEdit = true,
  onSave,
  onRescan,
  onClose,
}) {
  const [form, setForm] = useState({
    document_type: doc.document_type || 'OTHER',
    title: doc.title || '',
    document_number: doc.document_number || '',
    issue_date: doc.issue_date || '',
    expiry_date: doc.expiry_date || '',
    notes: doc.notes || '',
    institution: doc.institution || '',
    year_of_completion: doc.year_of_completion || '',
    grade_or_percentage: doc.grade_or_percentage || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }))
  const isQualification = qualificationTypes.includes(form.document_type)
  const status = SCAN_STATUS[doc.scan_status]

  const run = async (action) => {
    setBusy(true)
    setError('')
    try {
      await action()
      onClose()
    } catch (err) {
      const data = err?.response?.data
      setError(data?.error || data?.detail || (data && typeof data === 'object' ? Object.values(data).flat().join(' ') : '') || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    const payload = {
      document_type: form.document_type,
      title: form.title.trim(),
      document_number: form.document_number.trim(),
      issue_date: form.issue_date || null,
    }
    if (withExpiry) payload.expiry_date = form.expiry_date || null
    if (withNotes) payload.notes = form.notes
    if (isQualification) {
      payload.institution = form.institution.trim()
      payload.year_of_completion = form.year_of_completion ? parseInt(form.year_of_completion, 10) : null
      payload.grade_or_percentage = form.grade_or_percentage.trim()
    }
    run(() => onSave(payload))
  }

  return (
    <Modal open onClose={onClose} title={canEdit ? 'Document details' : 'Document'} size="4xl" closeOnBackdrop={false}>
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          {doc.file_url && isImageUrl(doc.file_url) ? (
            <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
              <img src={doc.file_url} alt={doc.title} className="w-full max-h-[60vh] object-contain rounded-lg border border-gray-200 bg-gray-50" />
            </a>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
              {doc.file_url ? 'This file has no preview.' : 'No file is attached to this record.'}
            </div>
          )}
          {doc.file_url && (
            <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-sm text-primary-600 hover:underline">Open file</a>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {status && (
            <div className="flex items-start gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              {doc.scan_note && <p className="text-xs text-gray-600">{doc.scan_note}</p>}
            </div>
          )}
          {doc.name_on_document && <p className="text-xs text-gray-600">Name on document: <span className="font-medium text-gray-900">{doc.name_on_document}</span></p>}
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

          <fieldset disabled={!canEdit || busy} className="space-y-3">
            <Field label="Type" required>
              <select value={form.document_type} onChange={set('document_type')} className="input w-full" required>
                {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Title" required>
              <input type="text" value={form.title} onChange={set('title')} className="input w-full" required maxLength={200} />
            </Field>
            <Field label="Document number">
              <input type="text" value={form.document_number} onChange={set('document_number')} className="input w-full" maxLength={100} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issue date">
                <input type="date" value={form.issue_date} onChange={set('issue_date')} className="input w-full" />
              </Field>
              {withExpiry && (
                <Field label="Expiry date">
                  <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className="input w-full" />
                </Field>
              )}
            </div>
            {isQualification && (
              <>
                <Field label="Institution">
                  <input type="text" value={form.institution} onChange={set('institution')} className="input w-full" maxLength={200} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Year of completion">
                    <input type="number" min="1950" max="2100" value={form.year_of_completion} onChange={set('year_of_completion')} className="input w-full" />
                  </Field>
                  <Field label="Grade / percentage">
                    <input type="text" value={form.grade_or_percentage} onChange={set('grade_or_percentage')} className="input w-full" maxLength={50} />
                  </Field>
                </div>
              </>
            )}
            {withNotes && (
              <Field label="Notes">
                <textarea value={form.notes} onChange={set('notes')} className="input w-full" rows={2} />
              </Field>
            )}
          </fieldset>

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            {canEdit && onRescan && doc.file_url && isImageUrl(doc.file_url) && (
              <button type="button" disabled={busy} onClick={() => run(onRescan)} className="mr-auto px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg disabled:opacity-50">Read image again</button>
            )}
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">{canEdit ? 'Cancel' : 'Close'}</button>
            {canEdit && <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>}
          </div>
        </form>
      </div>
    </Modal>
  )
}
