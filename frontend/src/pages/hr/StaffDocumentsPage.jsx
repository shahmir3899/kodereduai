import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'

const QUAL_TYPES = [
  { value: 'DEGREE', label: 'Degree', cls: 'bg-blue-100 text-blue-800' },
  { value: 'DIPLOMA', label: 'Diploma', cls: 'bg-purple-100 text-purple-800' },
  { value: 'CERTIFICATION', label: 'Certification', cls: 'bg-green-100 text-green-800' },
  { value: 'TRAINING', label: 'Training', cls: 'bg-orange-100 text-orange-800' },
  { value: 'LICENSE', label: 'License', cls: 'bg-teal-100 text-teal-800' },
]

const DOC_TYPES = [
  { value: 'ID_DOCUMENT', label: 'ID Document', cls: 'bg-blue-100 text-blue-800' },
  { value: 'CONTRACT', label: 'Contract', cls: 'bg-purple-100 text-purple-800' },
  { value: 'CERTIFICATE', label: 'Certificate', cls: 'bg-green-100 text-green-800' },
  { value: 'MEDICAL', label: 'Medical', cls: 'bg-red-100 text-red-800' },
  { value: 'OTHER', label: 'Other', cls: 'bg-gray-100 text-gray-800' },
]

const qualTypeMap = Object.fromEntries(QUAL_TYPES.map(t => [t.value, t]))
const docTypeMap = Object.fromEntries(DOC_TYPES.map(t => [t.value, t]))

const EMPTY_QUAL = { staff_member: '', qualification_type: '', qualification_name: '', institution: '', year_of_completion: '', grade_or_percentage: '' }
const EMPTY_DOC = { staff_member: '', document_type: '', title: '', file_url: '', notes: '' }

export default function StaffDocumentsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('qualifications')

  // Qualification state
  const [qualSearch, setQualSearch] = useState('')
  const [qualTypeFilter, setQualTypeFilter] = useState('')
  const [showQualModal, setShowQualModal] = useState(false)
  const [editQualId, setEditQualId] = useState(null)
  const [qualForm, setQualForm] = useState(EMPTY_QUAL)
  const [qualErrors, setQualErrors] = useState({})

  // Document state
  const [docSearch, setDocSearch] = useState('')
  const [docTypeFilter, setDocTypeFilter] = useState('')
  const [showDocModal, setShowDocModal] = useState(false)
  const [docForm, setDocForm] = useState(EMPTY_DOC)
  const [docErrors, setDocErrors] = useState({})

  // Fetch staff
  const { data: staffRes } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })
  const staffList = staffRes?.data?.results || staffRes?.data || []

  // Fetch qualifications
  const { data: qualRes, isLoading: qualLoading } = useQuery({
    queryKey: ['hrQualifications', qualSearch, qualTypeFilter],
    queryFn: () => hrApi.getQualifications({ search: qualSearch, qualification_type: qualTypeFilter || undefined, page_size: 200 }),
    enabled: tab === 'qualifications',
  })
  const qualifications = qualRes?.data?.results || qualRes?.data || []

  // Fetch documents
  const { data: docRes, isLoading: docLoading } = useQuery({
    queryKey: ['hrDocuments', docSearch, docTypeFilter],
    queryFn: () => hrApi.getDocuments({ search: docSearch, document_type: docTypeFilter || undefined, page_size: 200 }),
    enabled: tab === 'documents',
  })
  const documents = docRes?.data?.results || docRes?.data || []

  // Qualification mutations
  const createQualMutation = useMutation({
    mutationFn: (data) => hrApi.createQualification(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hrQualifications'] }); closeQualModal() },
    onError: (err) => setQualErrors(err.response?.data || { detail: 'Failed to create qualification' }),
  })

  const updateQualMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateQualification(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hrQualifications'] }); closeQualModal() },
    onError: (err) => setQualErrors(err.response?.data || { detail: 'Failed to update qualification' }),
  })

  const deleteQualMutation = useMutation({
    mutationFn: (id) => hrApi.deleteQualification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hrQualifications'] }),
  })

  // Document mutations
  const createDocMutation = useMutation({
    mutationFn: (data) => hrApi.createDocument(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hrDocuments'] }); closeDocModal() },
    onError: (err) => setDocErrors(err.response?.data || { detail: 'Failed to create document' }),
  })

  const deleteDocMutation = useMutation({
    mutationFn: (id) => hrApi.deleteDocument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hrDocuments'] }),
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
    const payload = { ...qualForm, year_of_completion: qualForm.year_of_completion ? parseInt(qualForm.year_of_completion) : null }
    if (editQualId) updateQualMutation.mutate({ id: editQualId, data: payload })
    else createQualMutation.mutate(payload)
  }

  // Document modal helpers
  const openDocCreate = () => { setDocForm(EMPTY_DOC); setDocErrors({}); setShowDocModal(true) }
  const closeDocModal = () => { setShowDocModal(false); setDocForm(EMPTY_DOC); setDocErrors({}) }

  const handleDocSubmit = (e) => {
    e.preventDefault()
    createDocMutation.mutate(docForm)
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
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
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${qualTypeMap[q.qualification_type]?.cls || 'bg-gray-100 text-gray-800'}`}>
                            {qualTypeMap[q.qualification_type]?.label || q.qualification_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700">{q.qualification_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{q.institution || '-'}</td>
                        <td className="px-4 py-2 text-sm text-center text-gray-600">{q.year_of_completion || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{q.grade_or_percentage || '-'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => openQualEdit(q)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          <button
                            onClick={() => { if (confirm('Delete this qualification?')) deleteQualMutation.mutate(q.id) }}
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${qualTypeMap[q.qualification_type]?.cls || 'bg-gray-100'}`}>
                        {qualTypeMap[q.qualification_type]?.label || q.qualification_type}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {q.institution && <span>{q.institution}</span>}
                      {q.year_of_completion && <span className="ml-2">({q.year_of_completion})</span>}
                      {q.grade_or_percentage && <span className="ml-2">Grade: {q.grade_or_percentage}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openQualEdit(q)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      <button
                        onClick={() => { if (confirm('Delete?')) deleteQualMutation.mutate(q.id) }}
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
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeQualModal}>
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
                    <select value={qualForm.staff_member} onChange={e => setQualForm(p => ({ ...p, staff_member: e.target.value }))} className="input w-full" required>
                      <option value="">Select staff...</option>
                      {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.employee_id})</option>)}
                    </select>
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
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
                      <th className="px-4 py-3 text-left">Uploaded</th>
                      <th className="px-4 py-3 text-left">Notes</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {documents.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{d.staff_member_name}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docTypeMap[d.document_type]?.cls || 'bg-gray-100 text-gray-800'}`}>
                            {docTypeMap[d.document_type]?.label || d.document_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700">{d.title}</td>
                        <td className="px-4 py-2 text-sm">
                          {d.file_url ? (
                            <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">View</a>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">{d.uploaded_at?.split('T')[0]}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 max-w-[200px] truncate">{d.notes || '-'}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => { if (confirm('Delete this document?')) deleteDocMutation.mutate(d.id) }}
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
                {documents.map(d => (
                  <div key={d.id} className="card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{d.staff_member_name}</p>
                        <p className="text-xs text-gray-600">{d.title}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docTypeMap[d.document_type]?.cls || 'bg-gray-100'}`}>
                        {docTypeMap[d.document_type]?.label || d.document_type}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {d.uploaded_at && <span>Uploaded: {d.uploaded_at.split('T')[0]}</span>}
                      {d.notes && <span className="ml-2">| {d.notes}</span>}
                    </div>
                    <div className="flex gap-2">
                      {d.file_url && (
                        <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">View File</a>
                      )}
                      <button
                        onClick={() => { if (confirm('Delete?')) deleteDocMutation.mutate(d.id) }}
                        className="text-xs text-red-600 hover:underline"
                      >Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Document Modal */}
          {showDocModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeDocModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Add Document</h2>
                  <button onClick={closeDocModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(docErrors.detail || docErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{docErrors.detail || docErrors.non_field_errors}</div>
                )}

                <form onSubmit={handleDocSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
                    <select value={docForm.staff_member} onChange={e => setDocForm(p => ({ ...p, staff_member: e.target.value }))} className="input w-full" required>
                      <option value="">Select staff...</option>
                      {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.employee_id})</option>)}
                    </select>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">File URL</label>
                    <input type="url" value={docForm.file_url} onChange={e => setDocForm(p => ({ ...p, file_url: e.target.value }))} className="input w-full" placeholder="https://..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea value={docForm.notes} onChange={e => setDocForm(p => ({ ...p, notes: e.target.value }))} className="input w-full" rows={2} placeholder="Additional notes..." />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeDocModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createDocMutation.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createDocMutation.isPending ? 'Saving...' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
