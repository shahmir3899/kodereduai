import { useEffect, useState } from 'react'
import ErrorState from '../../../components/ui/ErrorState'
import LoadingState from '../../../components/ui/LoadingState'
import EmptyState from '../../../components/ui/EmptyState'
import Badge from '../../../components/ui/Badge'
import { RecordCard, CardGrid } from '../../../components/cards'
import DocumentUploader from '../../../components/documents/DocumentUploader'
import DocumentEditModal, { SCAN_STATUS, isImageUrl } from '../../../components/documents/DocumentEditModal'
import { useConfirmModal } from '../../../components/ConfirmModal'
import { useToast } from '../../../components/Toast'
import { useAuth } from '../../../contexts/AuthContext'
import { studentsApi } from '../../../services/api'

const DOC_TYPES = [
  { value: 'BIRTH_CERT', label: 'Birth Certificate' },
  { value: 'B_FORM', label: 'B-Form / Student ID' },
  { value: 'GUARDIAN_ID', label: 'Parent / Guardian ID Card' },
  { value: 'PREV_REPORT', label: 'Previous Report Card' },
  { value: 'TC', label: 'Transfer Certificate' },
  { value: 'MEDICAL', label: 'Medical Record' },
  { value: 'PHOTO', label: 'Photo' },
  { value: 'OTHER', label: 'Other' },
]
const typeLabel = Object.fromEntries(DOC_TYPES.map((t) => [t.value, t.label]))
const POLL_MS = 3000

function Thumb({ doc }) {
  if (doc.file_url && isImageUrl(doc.file_url)) {
    return <img src={doc.file_url} alt="" loading="lazy" className="w-12 h-12 object-cover rounded border border-gray-200 flex-shrink-0" />
  }
  return <div className="w-12 h-12 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-[10px] text-gray-500 flex-shrink-0">FILE</div>
}

/**
 * A student's documents. Adding one is image-only: take a photo or choose a file and the
 * record is read from it on the server. Rows from an earlier branch arrive tagged
 * `read_only` and can be opened but not changed here.
 */
export default function StudentDocumentsTab({ studentId, data, refetch, isLoading, error }) {
  const { isSchoolAdmin } = useAuth()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { showError, showSuccess } = useToast()
  const [editing, setEditing] = useState(null)
  const docs = data?.documents || data || []

  // While the server is still reading an image, keep checking until it is done.
  const reading = docs.some((d) => d.scan_status === 'PENDING')
  useEffect(() => {
    if (!reading) return undefined
    const timer = setInterval(() => refetch(), POLL_MS)
    return () => clearInterval(timer)
  }, [reading, refetch])

  if (isLoading) return <LoadingState label="Loading documents..." />
  if (error) return <ErrorState message="Failed to load documents" compact />

  const remove = async (doc) => {
    const ok = await confirm({ title: 'Delete document', message: 'Delete this record and its file? This cannot be undone.' })
    if (!ok) return
    try {
      await studentsApi.deleteDocument(studentId, doc.id)
      showSuccess('Document deleted')
      refetch()
    } catch {
      showError('Failed to delete document')
    }
  }

  const save = async (doc, payload) => {
    await studentsApi.updateDocument(studentId, doc.id, payload)
    showSuccess('Saved.')
    refetch()
  }

  const rescan = async (doc) => {
    const { data: result } = await studentsApi.rescanDocument(studentId, doc.id)
    if (result?.duplicate) showSuccess('This was a copy of a document already on file, so it was not kept.')
    refetch()
  }

  return (
    <div className="space-y-4">
      {isSchoolAdmin && (
        <DocumentUploader upload={(file) => studentsApi.scanDocument(studentId, file)} onSettled={refetch} />
      )}

      {docs.length === 0 ? (
        <EmptyState title="No documents uploaded" />
      ) : (
        <CardGrid>
          {docs.map((doc) => {
            const scan = SCAN_STATUS[doc.scan_status]
            const canChange = isSchoolAdmin && !doc.read_only
            return (
              <RecordCard
                key={doc.id}
                leading={<Thumb doc={doc} />}
                title={doc.title}
                meta={new Date(doc.created_at).toLocaleDateString()}
                status={<Badge tone="neutral">{typeLabel[doc.document_type] || doc.document_type}</Badge>}
                stripeTone={doc.scan_status === 'NEEDS_REVIEW' ? 'warning' : undefined}
                fields={[
                  doc.document_number && { label: 'Number', value: doc.document_number, mono: true },
                  doc.issue_date && { label: 'Issued', value: doc.issue_date },
                  doc.expiry_date && { label: 'Expiry', value: doc.expiry_date },
                ].filter(Boolean)}
                actions={[
                  doc.scan_status !== 'PENDING' && { label: canChange ? 'View / Edit' : 'View', onClick: () => setEditing(doc) },
                  doc.file_url && { label: 'Open file', onClick: () => window.open(doc.file_url, '_blank', 'noopener') },
                  canChange && { label: 'Delete', tone: 'danger', onClick: () => remove(doc) },
                ].filter(Boolean)}
              >
                {(scan || doc.branch) && (
                  <div className="flex flex-wrap gap-1.5">
                    {scan && <Badge tone={scan.tone}>{scan.label}</Badge>}
                    {doc.branch && <Badge tone="neutral">{doc.branch}</Badge>}
                  </div>
                )}
              </RecordCard>
            )
          })}
        </CardGrid>
      )}

      {editing && (
        <DocumentEditModal
          doc={editing}
          typeOptions={DOC_TYPES}
          canEdit={isSchoolAdmin && !editing.read_only}
          onSave={(payload) => save(editing, payload)}
          onRescan={() => rescan(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmModalRoot />
    </div>
  )
}
