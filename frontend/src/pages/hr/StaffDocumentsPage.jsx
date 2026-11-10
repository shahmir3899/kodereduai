import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import Badge from '../../components/ui/Badge'
import StatCard from '../../components/dashboard/StatCard'
import StaffFilter from '../../components/StaffFilter'
import { RecordCard, CardGrid } from '../../components/cards'
import DocumentUploader from '../../components/documents/DocumentUploader'
import DocumentEditModal, { SCAN_STATUS, isImageUrl } from '../../components/documents/DocumentEditModal'
import { useConfirmModal } from '../../components/ConfirmModal'
import { useToast } from '../../components/Toast'
import { useDebounce } from '../../hooks/useDebounce'
import { hrApi } from '../../services/api'
import { compressImageForUpload } from '../../utils/compressImageForUpload'

const DOC_TYPES = [
  { value: 'ID_DOCUMENT', label: 'ID Document', tone: 'info' },
  { value: 'CONTRACT', label: 'Contract', tone: 'neutral' },
  { value: 'DEGREE', label: 'Degree', tone: 'info' },
  { value: 'DIPLOMA', label: 'Diploma', tone: 'neutral' },
  { value: 'CERTIFICATION', label: 'Certification', tone: 'success' },
  { value: 'TRAINING', label: 'Training', tone: 'warning' },
  { value: 'LICENSE', label: 'License', tone: 'info' },
  { value: 'CERTIFICATE', label: 'Certificate', tone: 'success' },
  { value: 'MEDICAL', label: 'Medical', tone: 'danger' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]
// These types are also a qualification (the timetable AI reads qualifications).
const QUALIFICATION_TYPES = ['DEGREE', 'DIPLOMA', 'CERTIFICATION', 'TRAINING', 'LICENSE']
const typeMap = Object.fromEntries(DOC_TYPES.map((t) => [t.value, t]))

const STATUS_FILTERS = [
  { value: '', label: 'All records' },
  { value: 'NEEDS_REVIEW', label: 'Needs review' },
  { value: 'NO_FILE', label: 'No file' },
  { value: 'EXPIRING', label: 'Expiring or expired' },
]

const EXPIRY_SOON_DAYS = 30
const POLL_MS = 3000

function expiryStatus(expiryDate) {
  if (!expiryDate) return null
  const days = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
  if (days < 0) return { tone: 'danger', label: 'Expired' }
  if (days <= EXPIRY_SOON_DAYS) return { tone: 'warning', label: `Expires in ${days}d` }
  return null
}

const list = (res) => res?.data?.results || res?.data || []

function Thumb({ doc }) {
  if (doc.file_url && isImageUrl(doc.file_url)) {
    return <img src={doc.file_url} alt="" loading="lazy" className="w-12 h-12 object-cover rounded border border-gray-200 flex-shrink-0" />
  }
  return (
    <div className="w-12 h-12 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-[10px] text-gray-500 flex-shrink-0">
      {doc.file_url ? 'FILE' : 'NO FILE'}
    </div>
  )
}

/**
 * One list for everything kept on staff: scanned documents, and older qualifications
 * that were typed with no file behind them (shown as "No file" until one is attached).
 * Adding a document is image-only: the record is read from the photo on the server.
 */
export default function StaffDocumentsPage() {
  const queryClient = useQueryClient()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { showSuccess, showError } = useToast()

  const [uploadStaff, setUploadStaff] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState(null) // a document row, or a no-file qualification shaped like one
  const attachInput = useRef(null)
  const attachTarget = useRef(null)
  const [attachingId, setAttachingId] = useState(null)

  const { data: staffRes } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })
  const staffList = list(staffRes)

  const params = { search: debouncedSearch || undefined, staff_member: staffFilter || undefined, page_size: 500 }
  const { data: docRes, isLoading: docLoading } = useQuery({
    queryKey: ['hrDocuments', debouncedSearch, staffFilter],
    queryFn: () => hrApi.getDocuments(params),
    // While the server is still reading an image, keep checking until it is done.
    refetchInterval: (query) => (list(query.state.data).some((d) => d.scan_status === 'PENDING') ? POLL_MS : false),
  })
  const { data: qualRes, isLoading: qualLoading } = useQuery({
    queryKey: ['hrQualifications', debouncedSearch, staffFilter],
    queryFn: () => hrApi.getQualifications(params),
  })
  const documents = list(docRes)
  const noFileRows = useMemo(() => list(qualRes).filter((q) => !q.document).map((q) => ({
    key: `q-${q.id}`,
    qualificationOnlyId: q.id,
    staff_member: q.staff_member,
    staff_member_name: q.staff_member_name,
    document_type: q.qualification_type,
    title: q.qualification_name,
    institution: q.institution,
    year_of_completion: q.year_of_completion,
    grade_or_percentage: q.grade_or_percentage,
    file_url: '',
  })), [qualRes])

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['hrDocuments'] })
    queryClient.invalidateQueries({ queryKey: ['hrQualifications'] })
  }

  const allRows = [...documents.map((d) => ({ ...d, key: `d-${d.id}` })), ...noFileRows]
  const rows = allRows.filter((r) => {
    if (typeFilter && r.document_type !== typeFilter) return false
    if (statusFilter === 'NEEDS_REVIEW') return r.scan_status === 'NEEDS_REVIEW'
    if (statusFilter === 'NO_FILE') return !r.file_url
    if (statusFilter === 'EXPIRING') return !!expiryStatus(r.expiry_date)
    return true
  })

  const needsReview = documents.filter((d) => d.scan_status === 'NEEDS_REVIEW').length
  const noFile = allRows.filter((r) => !r.file_url).length
  const expiringSoon = documents.filter((d) => expiryStatus(d.expiry_date)?.tone === 'warning').length
  const expired = documents.filter((d) => expiryStatus(d.expiry_date)?.tone === 'danger').length
  const loading = docLoading || qualLoading

  const remove = async (row) => {
    const ok = await confirm({
      title: 'Delete record',
      message: row.file_url
        ? 'Delete this record and its file? This cannot be undone.'
        : 'Delete this record? This cannot be undone.',
    })
    if (!ok) return
    try {
      if (row.qualificationOnlyId) await hrApi.deleteQualification(row.qualificationOnlyId)
      else await hrApi.deleteDocument(row.id)
      showSuccess('Deleted.')
      reload()
    } catch (err) {
      showError(err.response?.data?.detail || 'Failed to delete.')
    }
  }

  const save = async (row, payload) => {
    if (row.qualificationOnlyId) {
      await hrApi.updateQualification(row.qualificationOnlyId, {
        qualification_type: QUALIFICATION_TYPES.includes(payload.document_type) ? payload.document_type : row.document_type,
        qualification_name: payload.title,
        institution: payload.institution || '',
        year_of_completion: payload.year_of_completion ?? null,
        grade_or_percentage: payload.grade_or_percentage || '',
      })
    } else {
      await hrApi.updateDocumentDetails(row.id, payload)
    }
    showSuccess('Saved.')
    reload()
  }

  const rescan = async (row) => {
    const { data } = await hrApi.rescanDocument(row.id)
    if (data?.duplicate) showSuccess('This was a copy of a document already on file, so it was not kept.')
    reload()
  }

  const startAttach = (row) => {
    attachTarget.current = row
    attachInput.current?.click()
  }

  const attach = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const row = attachTarget.current
    if (!file || !row) return
    setAttachingId(row.qualificationOnlyId)
    try {
      const toSend = file.type.startsWith('image/') ? await compressImageForUpload(file) : file
      const { data } = await hrApi.scanDocument(row.staff_member, toSend, row.qualificationOnlyId)
      if (data?.duplicate) showError('That file is already on record for this staff member, so it was not attached.')
      else showSuccess('File attached.')
      reload()
    } catch (err) {
      showError(err.response?.data?.error || 'Failed to attach the file.')
    } finally {
      setAttachingId(null)
    }
  }

  return (
    <div>
      <PageHeader title="Staff Documents" subtitle="Upload a photo or file. The details are read from it automatically." className="mb-6" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Records" value={loading ? '-' : allRows.length} color="blue" />
        <StatCard label="Needs Review" value={loading ? '-' : needsReview} color={needsReview > 0 ? 'amber' : 'green'} />
        <StatCard label="No File" value={loading ? '-' : noFile} color={noFile > 0 ? 'amber' : 'green'} />
        <StatCard label="Expiring Soon" value={loading ? '-' : expiringSoon} subtitle={`within ${EXPIRY_SOON_DAYS} days`} color={expiringSoon > 0 ? 'amber' : 'green'} />
        <StatCard label="Expired" value={loading ? '-' : expired} color={expired > 0 ? 'red' : 'green'} />
      </div>

      {/* Add documents: pick the person once, then only images or files. */}
      <div className="mb-6">
        <div className="mb-2 max-w-sm">
          <label className="label">Add documents for</label>
          <StaffFilter
            options={staffList}
            value={uploadStaff}
            onChange={(e) => setUploadStaff(e.target.value)}
            placeholder="Select staff..."
          />
        </div>
        <DocumentUploader
          disabled={!uploadStaff}
          disabledHint="Select a staff member first."
          upload={(file) => hrApi.scanDocument(uploadStaff, file)}
          onSettled={reload}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by staff name or title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full sm:w-64"
          aria-label="Search records"
        />
        <StaffFilter
          options={staffList}
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
          showAllOption
          allOptionLabel="All staff"
          className="w-full sm:w-56"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input w-full sm:w-44" aria-label="Filter by type">
          <option value="">All types</option>
          {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-full sm:w-48" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <LoadingState label="Loading records..." />
      ) : rows.length === 0 ? (
        <EmptyState title="No records found" />
      ) : (
        <CardGrid>
          {rows.map((row) => {
            const scan = SCAN_STATUS[row.scan_status]
            const expiry = expiryStatus(row.expiry_date)
            const reading = row.scan_status === 'PENDING'
            const type = typeMap[row.document_type]
            return (
              <RecordCard
                key={row.key}
                leading={<Thumb doc={row} />}
                title={row.title}
                meta={row.staff_member_name}
                status={<Badge tone={type?.tone || 'neutral'}>{type?.label || row.document_type}</Badge>}
                stripeTone={row.scan_status === 'NEEDS_REVIEW' || !row.file_url ? 'warning' : undefined}
                fields={[
                  row.document_number && { label: 'Number', value: row.document_number, mono: true },
                  row.institution && { label: 'Institution', value: row.institution },
                  row.year_of_completion && { label: 'Year', value: row.year_of_completion },
                  row.expiry_date && { label: 'Expiry', value: row.expiry_date },
                  row.uploaded_at && { label: 'Uploaded', value: row.uploaded_at.split('T')[0] },
                ].filter(Boolean)}
                actions={[
                  !reading && { label: row.file_url ? 'View / Edit' : 'Edit', onClick: () => setEditing(row) },
                  row.file_url && { label: 'Open file', onClick: () => window.open(row.file_url, '_blank', 'noopener') },
                  row.qualificationOnlyId && {
                    label: attachingId === row.qualificationOnlyId ? 'Attaching…' : 'Attach file',
                    tone: 'success',
                    disabled: attachingId === row.qualificationOnlyId,
                    onClick: () => startAttach(row),
                  },
                  { label: 'Delete', tone: 'danger', onClick: () => remove(row) },
                ].filter(Boolean)}
              >
                {(scan || expiry || !row.file_url) && (
                  <div className="flex flex-wrap gap-1.5">
                    {scan && <Badge tone={scan.tone}>{scan.label}</Badge>}
                    {!row.file_url && <Badge tone="warning">No file</Badge>}
                    {expiry && <Badge tone={expiry.tone}>{expiry.label}</Badge>}
                  </div>
                )}
              </RecordCard>
            )
          })}
        </CardGrid>
      )}

      <input ref={attachInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx" className="hidden" onChange={attach} />

      {editing && (
        <DocumentEditModal
          doc={editing}
          typeOptions={editing.qualificationOnlyId ? DOC_TYPES.filter((t) => QUALIFICATION_TYPES.includes(t.value)) : DOC_TYPES}
          qualificationTypes={QUALIFICATION_TYPES}
          withExpiry={!editing.qualificationOnlyId}
          withNotes={!editing.qualificationOnlyId}
          onSave={(payload) => save(editing, payload)}
          onRescan={editing.qualificationOnlyId ? undefined : () => rescan(editing)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmModalRoot />
    </div>
  )
}
