import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useConfirmModal } from '../../components/ConfirmModal'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import StatCard from '../../components/dashboard/StatCard'
import StaffFilter from '../../components/StaffFilter'
import { useDebounce } from '../../hooks/useDebounce'
import { useEscapeKey } from '../../hooks/useEscapeKey'

const QUAL_TYPES = [
  { value: 'DEGREE', label: 'Degree', tone: 'info' },
  { value: 'DIPLOMA', label: 'Diploma', tone: 'neutral' },
  { value: 'CERTIFICATION', label: 'Certification', tone: 'success' },
  { value: 'TRAINING', label: 'Training', tone: 'warning' },
  { value: 'LICENSE', label: 'License', tone: 'info' },
]

const DOC_TYPES = [
  { value: 'ID_DOCUMENT', label: 'ID Document', tone: 'info' },
  { value: 'CONTRACT', label: 'Contract', tone: 'neutral' },
  { value: 'CERTIFICATE', label: 'Certificate', tone: 'success' },
  { value: 'MEDICAL', label: 'Medical', tone: 'danger' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]

const qualTypeMap = Object.fromEntries(QUAL_TYPES.map(t => [t.value, t]))
const docTypeMap = Object.fromEntries(DOC_TYPES.map(t => [t.value, t]))

const EMPTY_QUAL = { staff_member: '', qualification_type: '', qualification_name: '', institution: '', year_of_completion: '', grade_or_percentage: '' }
const EMPTY_DOC = { staff_member: '', document_type: '', title: '', notes: '', expiry_date: '' }

const EXPIRY_SOON_DAYS = 30

function expiryStatus(expiryDate) {
  if (!expiryDate) return null
  const days = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
  if (days < 0) return { tone: 'danger', label: 'Expired' }
  if (days <= EXPIRY_SOON_DAYS) return { tone: 'warning', label: `Expires in ${days}d` }
  return null
}

export default function StaffDocumentsPage() {
  const queryClient = useQueryClient()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { showSuccess, showError } = useToast()
  const [tab, setTab] = useState('qualifications')
  const [detailItem, setDetailItem] = useState(null) // { kind: 'qualification' | 'document', item }

  // Qualification state
  const [qualSearch, setQualSearch] = useState('')
  const debouncedQualSearch = useDebounce(qualSearch, 300)
  const [qualTypeFilter, setQualTypeFilter] = useState('')
  const [showQualModal, setShowQualModal] = useState(false)
  const [editQualId, setEditQualId] = useState(null)
  const [qualForm, setQualForm] = useState(EMPTY_QUAL)
  const [qualErrors, setQualErrors] = useState({})

  // Document state
  const [docSearch, setDocSearch] = useState('')
  const debouncedDocSearch = useDebounce(docSearch, 300)
  const [docTypeFilter, setDocTypeFilter] = useState('')
  const [showDocModal, setShowDocModal] = useState(false)
  const [editDocId, setEditDocId] = useState(null)
  const [docForm, setDocForm] = useState(EMPTY_DOC)
  const [docFile, setDocFile] = useState(null) // File object; optional on edit
  const [existingFileUrl, setExistingFileUrl] = useState(null) // current file_url when editing
  const [docErrors, setDocErrors] = useState({})

  // Fetch staff
  const { data: staffRes } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })
  const staffList = staffRes?.data?.results || staffRes?.data || []

  // Fetch qualifications
  const { data: qualRes, isLoading: qualLoading } = useQuery({
    queryKey: ['hrQualifications', debouncedQualSearch, qualTypeFilter],
    queryFn: () => hrApi.getQualifications({ search: debouncedQualSearch, qualification_type: qualTypeFilter || undefined, page_size: 200 }),
    enabled: tab === 'qualifications',
  })
  const qualifications = qualRes?.data?.results || qualRes?.data || []

  // Fetch documents
  const { data: docRes, isLoading: docLoading } = useQuery({
    queryKey: ['hrDocuments', debouncedDocSearch, docTypeFilter],
    queryFn: () => hrApi.getDocuments({ search: debouncedDocSearch, document_type: docTypeFilter || undefined, page_size: 200 }),
    enabled: tab === 'documents',
  })
  const documents = docRes?.data?.results || docRes?.data || []

  // KPI summary — computed client-side from the already-fetched lists, no extra endpoint needed.
  const qualTypeCounts = QUAL_TYPES.map(t => ({
    ...t,
    count: qualifications.filter(q => q.qualification_type === t.value).length,
  }))
  const staffWithoutDocuments = staffList.length
    ? staffList.filter(s => !documents.some(d => d.staff_member === s.id)).length
    : 0
  const expiringSoonCount = documents.filter(d => {
    const status = expiryStatus(d.expiry_date)
    return status && status.tone === 'warning'
  }).length
  const expiredCount = documents.filter(d => expiryStatus(d.expiry_date)?.tone === 'danger').length

  // Qualification mutations
  const createQualMutation = useMutation({
    mutationFn: (data) => hrApi.createQualification(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrQualifications'] })
      closeQualModal()
      showSuccess('Qualification added successfully!')
    },
    onError: (err) => setQualErrors(err.response?.data || { detail: 'Failed to create qualification' }),
  })

  const updateQualMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateQualification(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrQualifications'] })
      closeQualModal()
      showSuccess('Qualification updated successfully!')
    },
    onError: (err) => setQualErrors(err.response?.data || { detail: 'Failed to update qualification' }),
  })

  const deleteQualMutation = useMutation({
    mutationFn: (id) => hrApi.deleteQualification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrQualifications'] })
      showSuccess('Qualification deleted successfully!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete qualification'),
  })

  // Document mutations
  const createDocMutation = useMutation({
    mutationFn: (data) => hrApi.createDocument(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDocuments'] })
      closeDocModal()
      showSuccess('Document added successfully!')
    },
    onError: (err) => setDocErrors(err.response?.data || { detail: 'Failed to create document' }),
  })

  const updateDocMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateDocument(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDocuments'] })
      closeDocModal()
      showSuccess('Document updated successfully!')
    },
    onError: (err) => setDocErrors(err.response?.data || { detail: 'Failed to update document' }),
  })

  const deleteDocMutation = useMutation({
    mutationFn: (id) => hrApi.deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDocuments'] })
      showSuccess('Document deleted successfully!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete document'),
  })

  // Qualification modal helpers
  const openQualCreate = () => { setQualForm(EMPTY_QUAL); setEditQualId(null); setQualErrors({}); setShowQualModal(true) }
  const openQualEdit = (q) => {
    setQualForm({
      staff_member: q.staff_member,
      qualification_type: q.qualification_type,
      qualification_name: q.qualification_name || '',
      institution: q.institution || '',
      year_of_completion: q.year_of_completion || '',
      grade_or_percentage: q.grade_or_percentage || '',
    })
    setEditQualId(q.id)
    setQualErrors({})
    setShowQualModal(true)
  }
  const closeQualModal = () => { setShowQualModal(false); setEditQualId(null); setQualForm(EMPTY_QUAL); setQualErrors({}) }

  const handleQualSubmit = (e) => {
    e.preventDefault()
    if (!qualForm.staff_member) {
      setQualErrors({ detail: 'Please select a staff member.' })
      return
    }
    const payload = { ...qualForm, year_of_completion: qualForm.year_of_completion ? parseInt(qualForm.year_of_completion) : null }
    if (editQualId) updateQualMutation.mutate({ id: editQualId, data: payload })
    else createQualMutation.mutate(payload)
  }

  // Document modal helpers
  const openDocCreate = () => {
    setDocForm(EMPTY_DOC)
    setEditDocId(null)
    setDocFile(null)
    setExistingFileUrl(null)
    setDocErrors({})
    setShowDocModal(true)
  }
  const openDocEdit = (d) => {
    setDocForm({
      staff_member: d.staff_member,
      document_type: d.document_type,
      title: d.title || '',
      notes: d.notes || '',
      expiry_date: d.expiry_date || '',
    })
    setEditDocId(d.id)
    setDocFile(null)
    setExistingFileUrl(d.file_url || null)
    setDocErrors({})
    setShowDocModal(true)
  }
  const closeDocModal = () => {
    setShowDocModal(false)
    setEditDocId(null)
    setDocForm(EMPTY_DOC)
    setDocFile(null)
    setExistingFileUrl(null)
    setDocErrors({})
  }

  useEscapeKey(closeQualModal, showQualModal)
  useEscapeKey(closeDocModal, showDocModal)
  useEscapeKey(() => setDetailItem(null), !!detailItem)

  const handleDocSubmit = (e) => {
    e.preventDefault()
    if (!docForm.staff_member) {
      setDocErrors({ detail: 'Please select a staff member.' })
      return
    }
    if (!editDocId && !docFile) {
      setDocErrors({ detail: 'Please choose a file to upload.' })
      return
    }
    const payload = { ...docForm, file: docFile || undefined }
    if (editDocId) updateDocMutation.mutate({ id: editDocId, data: payload })
    else createDocMutation.mutate(payload)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Staff Documents</h1>
          <p className="text-sm text-gray-600">Manage qualifications and documents</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('qualifications')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'qualifications' ? 'bg-white shadow text-primary-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Qualifications
        </button>
        <button
          onClick={() => setTab('documents')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'documents' ? 'bg-white shadow text-primary-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Documents
        </button>
      </div>

      {/* Qualifications Tab */}
      {tab === 'qualifications' && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard label="Total Qualifications" value={qualLoading ? '-' : qualifications.length} color="blue" />
            <div className="card lg:col-span-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">By Type</p>
              <div className="flex flex-wrap gap-3">
                {qualTypeCounts.map(t => (
                  <div key={t.value} className="flex items-center gap-1.5 text-sm">
                    <Badge tone={t.tone}>{t.label}</Badge>
                    <span className="text-gray-600">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              placeholder="Search by staff name..."
              value={qualSearch}
              onChange={e => setQualSearch(e.target.value)}
              className="input w-full sm:w-60"
            />
            <select
              value={qualTypeFilter}
              onChange={e => setQualTypeFilter(e.target.value)}
              className="input w-full sm:w-48"
            >
              <option value="">All Types</option>
              {QUAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button onClick={openQualCreate} className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
              + Add Qualification
            </button>
          </div>

          {qualLoading ? (
            <div className="text-center py-12">
              <Spinner size="md" className="mx-auto" />
            </div>
          ) : qualifications.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No qualifications found.</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Staff Member</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Qualification</th>
                      <th className="px-4 py-3 text-left">Institution</th>
                      <th className="px-4 py-3 text-center">Year</th>
                      <th className="px-4 py-3 text-left">Grade</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {qualifications.map(q => (
                      <tr key={q.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{q.staff_member_name}</td>
                        <td className="px-4 py-2">
                          <Badge tone={qualTypeMap[q.qualification_type]?.tone || 'neutral'}>
                            {qualTypeMap[q.qualification_type]?.label || q.qualification_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700">{q.qualification_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{q.institution || '-'}</td>
                        <td className="px-4 py-2 text-sm text-center text-gray-600">{q.year_of_completion || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{q.grade_or_percentage || '-'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setDetailItem({ kind: 'qualification', item: q })} className="text-xs text-primary-600 hover:underline mr-2">View</button>
                          <button onClick={() => openQualEdit(q)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          <button
                            onClick={async () => { const ok = await confirm({ title: 'Delete Qualification', message: 'Delete this qualification? This cannot be undone.' }); if (ok) deleteQualMutation.mutate(q.id) }}
                            className="text-xs text-red-600 hover:underline"
                          >Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {qualifications.map(q => (
                  <div key={q.id} className="card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{q.staff_member_name}</p>
                        <p className="text-xs text-gray-600">{q.qualification_name}</p>
                      </div>
                      <Badge tone={qualTypeMap[q.qualification_type]?.tone || 'neutral'}>
                        {qualTypeMap[q.qualification_type]?.label || q.qualification_type}
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {q.institution && <span>{q.institution}</span>}
                      {q.year_of_completion && <span className="ml-2">({q.year_of_completion})</span>}
                      {q.grade_or_percentage && <span className="ml-2">Grade: {q.grade_or_percentage}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setDetailItem({ kind: 'qualification', item: q })} className="text-xs text-primary-600 hover:underline">View</button>
                      <button onClick={() => openQualEdit(q)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      <button
                        onClick={async () => { const ok = await confirm({ title: 'Delete Qualification', message: 'Delete this qualification? This cannot be undone.' }); if (ok) deleteQualMutation.mutate(q.id) }}
                        className="text-xs text-red-600 hover:underline"
                      >Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Qualification Modal */}
          {showQualModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={closeQualModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{editQualId ? 'Edit Qualification' : 'Add Qualification'}</h2>
                  <button onClick={closeQualModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(qualErrors.detail || qualErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{qualErrors.detail || qualErrors.non_field_errors}</div>
                )}

                <form onSubmit={handleQualSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
                    <StaffFilter
                      options={staffList}
                      value={qualForm.staff_member}
                      onChange={e => setQualForm(p => ({ ...p, staff_member: e.target.value }))}
                      placeholder="Select staff..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                    <select value={qualForm.qualification_type} onChange={e => setQualForm(p => ({ ...p, qualification_type: e.target.value }))} className="input w-full" required>
                      <option value="">Select type...</option>
                      {QUAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Qualification Name *</label>
                    <input type="text" value={qualForm.qualification_name} onChange={e => setQualForm(p => ({ ...p, qualification_name: e.target.value }))} className="input w-full" required placeholder="e.g. B.Ed, MBA" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Institution</label>
                    <input type="text" value={qualForm.institution} onChange={e => setQualForm(p => ({ ...p, institution: e.target.value }))} className="input w-full" placeholder="University or institute name" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Year of Completion</label>
                      <input type="number" min="1950" max="2099" value={qualForm.year_of_completion} onChange={e => setQualForm(p => ({ ...p, year_of_completion: e.target.value }))} className="input w-full" placeholder="2020" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Grade / Percentage</label>
                      <input type="text" value={qualForm.grade_or_percentage} onChange={e => setQualForm(p => ({ ...p, grade_or_percentage: e.target.value }))} className="input w-full" placeholder="e.g. A+, 85%" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeQualModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createQualMutation.isPending || updateQualMutation.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createQualMutation.isPending || updateQualMutation.isPending ? 'Saving...' : editQualId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Documents" value={docLoading ? '-' : documents.length} color="blue" />
            <StatCard
              label="Staff Missing Documents"
              value={docLoading ? '-' : staffWithoutDocuments}
              subtitle={`out of ${staffList.length} active staff`}
              color={staffWithoutDocuments > 0 ? 'amber' : 'green'}
            />
            <StatCard
              label="Expiring Soon"
              value={docLoading ? '-' : expiringSoonCount}
              subtitle={`within ${EXPIRY_SOON_DAYS} days`}
              color={expiringSoonCount > 0 ? 'amber' : 'green'}
            />
            <StatCard
              label="Expired"
              value={docLoading ? '-' : expiredCount}
              color={expiredCount > 0 ? 'red' : 'green'}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              placeholder="Search by staff name..."
              value={docSearch}
              onChange={e => setDocSearch(e.target.value)}
              className="input w-full sm:w-60"
            />
            <select
              value={docTypeFilter}
              onChange={e => setDocTypeFilter(e.target.value)}
              className="input w-full sm:w-48"
            >
              <option value="">All Types</option>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button onClick={openDocCreate} className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
              + Add Document
            </button>
          </div>

          {docLoading ? (
            <div className="text-center py-12">
              <Spinner size="md" className="mx-auto" />
            </div>
          ) : documents.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No documents found.</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Staff Member</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Title</th>
                      <th className="px-4 py-3 text-left">File</th>
                      <th className="px-4 py-3 text-left">Expiry</th>
                      <th className="px-4 py-3 text-left">Uploaded</th>
                      <th className="px-4 py-3 text-left">Notes</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {documents.map(d => {
                      const expiry = expiryStatus(d.expiry_date)
                      return (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{d.staff_member_name}</td>
                        <td className="px-4 py-2">
                          <Badge tone={docTypeMap[d.document_type]?.tone || 'neutral'}>
                            {docTypeMap[d.document_type]?.label || d.document_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700">{d.title}</td>
                        <td className="px-4 py-2 text-sm">
                          {d.file_url ? (
                            <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">Open</a>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {d.expiry_date ? (
                            <div className="flex items-center gap-1.5">
                              <span>{d.expiry_date}</span>
                              {expiry && <Badge tone={expiry.tone}>{expiry.label}</Badge>}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">{d.uploaded_at?.split('T')[0]}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 max-w-[200px] truncate">{d.notes || '-'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setDetailItem({ kind: 'document', item: d })} className="text-xs text-primary-600 hover:underline mr-2">View</button>
                          <button onClick={() => openDocEdit(d)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          <button
                            onClick={async () => { const ok = await confirm({ title: 'Delete Document', message: 'Delete this document? This cannot be undone.' }); if (ok) deleteDocMutation.mutate(d.id) }}
                            className="text-xs text-red-600 hover:underline"
                          >Delete</button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {documents.map(d => {
                  const expiry = expiryStatus(d.expiry_date)
                  return (
                  <div key={d.id} className="card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{d.staff_member_name}</p>
                        <p className="text-xs text-gray-600">{d.title}</p>
                      </div>
                      <Badge tone={docTypeMap[d.document_type]?.tone || 'neutral'}>
                        {docTypeMap[d.document_type]?.label || d.document_type}
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {d.uploaded_at && <span>Uploaded: {d.uploaded_at.split('T')[0]}</span>}
                      {d.notes && <span className="ml-2">| {d.notes}</span>}
                    </div>
                    {(d.expiry_date || expiry) && (
                      <div className="flex items-center gap-1.5 mb-2 text-xs text-gray-500">
                        {d.expiry_date && <span>Expires: {d.expiry_date}</span>}
                        {expiry && <Badge tone={expiry.tone}>{expiry.label}</Badge>}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => setDetailItem({ kind: 'document', item: d })} className="text-xs text-primary-600 hover:underline">View</button>
                      <button onClick={() => openDocEdit(d)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      {d.file_url && (
                        <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">Open File</a>
                      )}
                      <button
                        onClick={async () => { const ok = await confirm({ title: 'Delete Document', message: 'Delete this document? This cannot be undone.' }); if (ok) deleteDocMutation.mutate(d.id) }}
                        className="text-xs text-red-600 hover:underline"
                      >Delete</button>
                    </div>
                  </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Document Modal */}
          {showDocModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={closeDocModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{editDocId ? 'Edit Document' : 'Add Document'}</h2>
                  <button onClick={closeDocModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(docErrors.detail || docErrors.error || docErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{docErrors.detail || docErrors.error || docErrors.non_field_errors}</div>
                )}

                <form onSubmit={handleDocSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
                    <StaffFilter
                      options={staffList}
                      value={docForm.staff_member}
                      onChange={e => setDocForm(p => ({ ...p, staff_member: e.target.value }))}
                      placeholder="Select staff..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Document Type *</label>
                    <select value={docForm.document_type} onChange={e => setDocForm(p => ({ ...p, document_type: e.target.value }))} className="input w-full" required>
                      <option value="">Select type...</option>
                      {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                    <input type="text" value={docForm.title} onChange={e => setDocForm(p => ({ ...p, title: e.target.value }))} className="input w-full" required placeholder="e.g. Aadhaar Card, Employment Contract" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      File {editDocId ? '(leave blank to keep the current file)' : '*'}
                    </label>
                    {existingFileUrl && (
                      <p className="text-xs text-gray-500 mb-1">
                        Current file: <a href={existingFileUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">Open</a>
                      </p>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={e => setDocFile(e.target.files?.[0] || null)}
                      className="input w-full"
                      required={!editDocId}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
                    <input type="date" value={docForm.expiry_date} onChange={e => setDocForm(p => ({ ...p, expiry_date: e.target.value }))} className="input w-full" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea value={docForm.notes} onChange={e => setDocForm(p => ({ ...p, notes: e.target.value }))} className="input w-full" rows={2} placeholder="Additional notes..." />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeDocModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createDocMutation.isPending || updateDocMutation.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createDocMutation.isPending || updateDocMutation.isPending ? 'Saving...' : editDocId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal (Qualification or Document) */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setDetailItem(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {detailItem.kind === 'qualification' ? 'Qualification Details' : 'Document Details'}
              </h2>
              <button onClick={() => setDetailItem(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {detailItem.kind === 'qualification' ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500">Staff Member</p>
                  <p className="text-sm font-medium">{detailItem.item.staff_member_name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Type</p>
                  <Badge tone={qualTypeMap[detailItem.item.qualification_type]?.tone || 'neutral'}>
                    {qualTypeMap[detailItem.item.qualification_type]?.label || detailItem.item.qualification_type}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Qualification Name</p>
                  <p className="text-sm">{detailItem.item.qualification_name}</p>
                </div>
                {detailItem.item.institution && (
                  <div>
                    <p className="text-xs text-gray-500">Institution</p>
                    <p className="text-sm">{detailItem.item.institution}</p>
                  </div>
                )}
                {detailItem.item.year_of_completion && (
                  <div>
                    <p className="text-xs text-gray-500">Year of Completion</p>
                    <p className="text-sm">{detailItem.item.year_of_completion}</p>
                  </div>
                )}
                {detailItem.item.grade_or_percentage && (
                  <div>
                    <p className="text-xs text-gray-500">Grade / Percentage</p>
                    <p className="text-sm">{detailItem.item.grade_or_percentage}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500">Staff Member</p>
                  <p className="text-sm font-medium">{detailItem.item.staff_member_name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Type</p>
                  <Badge tone={docTypeMap[detailItem.item.document_type]?.tone || 'neutral'}>
                    {docTypeMap[detailItem.item.document_type]?.label || detailItem.item.document_type}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Title</p>
                  <p className="text-sm">{detailItem.item.title}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Uploaded</p>
                  <p className="text-sm">{detailItem.item.uploaded_at?.split('T')[0] || '-'}</p>
                </div>
                {detailItem.item.file_url && (
                  <div>
                    <p className="text-xs text-gray-500">File</p>
                    <a href={detailItem.item.file_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline">Open File</a>
                  </div>
                )}
                {detailItem.item.expiry_date && (
                  <div>
                    <p className="text-xs text-gray-500">Expiry Date</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{detailItem.item.expiry_date}</p>
                      {(() => {
                        const status = expiryStatus(detailItem.item.expiry_date)
                        return status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                      })()}
                    </div>
                  </div>
                )}
                {detailItem.item.notes && (
                  <div>
                    <p className="text-xs text-gray-500">Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{detailItem.item.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModalRoot />
    </div>
  )
}
