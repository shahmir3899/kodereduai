import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const EMPTY_DEPT = { name: '', description: '' }
const EMPTY_DESIG = { name: '', department: '' }
const EMPTY_STAFF = {
  first_name: '', last_name: '', email: '', phone: '',
  department: '', designation: '', employee_id: '',
  employment_type: 'FULL_TIME', gender: '',
}

export default function StaffStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState('departments')
  const [deptForm, setDeptForm] = useState(EMPTY_DEPT)
  const [desigForm, setDesigForm] = useState(EMPTY_DESIG)
  const [staffForm, setStaffForm] = useState(EMPTY_STAFF)
  const [showForm, setShowForm] = useState(false)
  const [errors, setErrors] = useState({})

  // Queries
  const { data: deptsRes } = useQuery({
    queryKey: ['departments'],
    queryFn: () => hrApi.getDepartments({ page_size: 100 }),
  })
  const depts = deptsRes?.data?.results || deptsRes?.data || []

  const { data: desigsRes } = useQuery({
    queryKey: ['designations'],
    queryFn: () => hrApi.getDesignations({ page_size: 100 }),
  })
  const desigs = desigsRes?.data?.results || desigsRes?.data || []

  const { data: staffRes } = useQuery({
    queryKey: ['staff'],
    queryFn: () => hrApi.getStaff({ page_size: 200 }),
  })
  const staffList = staffRes?.data?.results || staffRes?.data || []

  const { data: nextIdRes } = useQuery({
    queryKey: ['nextEmployeeId'],
    queryFn: () => hrApi.getNextEmployeeId(),
    enabled: activeTab === 'staff',
  })

  // Mutations
  const createDeptMut = useMutation({
    mutationFn: (data) => hrApi.createDepartment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      refetchCompletion()
      addToast('Department created!', 'success')
      setDeptForm(EMPTY_DEPT)
      setShowForm(false)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const createDesigMut = useMutation({
    mutationFn: (data) => hrApi.createDesignation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['designations'] })
      refetchCompletion()
      addToast('Designation created!', 'success')
      setDesigForm(EMPTY_DESIG)
      setShowForm(false)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const createStaffMut = useMutation({
    mutationFn: (data) => hrApi.createStaff(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['nextEmployeeId'] })
      refetchCompletion()
      addToast('Staff member added!', 'success')
      setStaffForm(EMPTY_STAFF)
      setShowForm(false)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const tabs = [
    { key: 'departments', label: 'Departments', count: depts.length, target: 2 },
    { key: 'designations', label: 'Designations', count: desigs.length, target: 3 },
    { key: 'staff', label: 'Staff Members', count: staffList.length, target: 3 },
  ]

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Staff & HR Setup</h2>
      <p className="text-sm text-gray-500 mb-6">Set up departments, designations, and add staff members.</p>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setShowForm(false); setErrors({}) }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === t.key ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${t.count >= t.target ? 'text-green-600' : 'text-gray-400'}`}>
              {t.count >= t.target ? `✓ ${t.count}` : `${t.count} of ${t.target}`}
            </span>
          </button>
        ))}
      </div>

      {/* Departments Tab */}
      {activeTab === 'departments' && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Departments ({depts.length})</h3>
            <button onClick={() => setShowForm(true)} className="text-xs text-sky-600 hover:text-sky-700">+ Add</button>
          </div>
          {depts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {depts.map(d => (
                <span key={d.id} className="px-3 py-1.5 bg-gray-50 rounded-lg text-sm text-gray-700 border">
                  {d.name}
                </span>
              ))}
            </div>
          )}
          {depts.length === 0 && !showForm && (
            <p className="text-sm text-gray-400 mb-3">No departments yet. Add departments like "Teaching", "Administration", etc.</p>
          )}
          {showForm && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Department Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Teaching"
                    value={deptForm.name}
                    onChange={e => { setDeptForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional"
                    value={deptForm.description}
                    onChange={e => setDeptForm(p => ({ ...p, description: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => createDeptMut.mutate(deptForm)}
                  disabled={createDeptMut.isPending}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  {createDeptMut.isPending ? 'Adding...' : 'Add Department'}
                </button>
                <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Designations Tab */}
      {activeTab === 'designations' && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Designations ({desigs.length})</h3>
            <button onClick={() => setShowForm(true)} className="text-xs text-sky-600 hover:text-sky-700">+ Add</button>
          </div>
          {desigs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {desigs.map(d => (
                <span key={d.id} className="px-3 py-1.5 bg-gray-50 rounded-lg text-sm text-gray-700 border">
                  {d.name}
                  {d.department_name && <span className="text-xs text-gray-400 ml-1">({d.department_name})</span>}
                </span>
              ))}
            </div>
          )}
          {desigs.length === 0 && !showForm && (
            <p className="text-sm text-gray-400 mb-3">No designations yet. Add roles like "Principal", "Senior Teacher", "Clerk".</p>
          )}
          {showForm && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Designation Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Senior Teacher"
                    value={desigForm.name}
                    onChange={e => { setDesigForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                  <select
                    className="input"
                    value={desigForm.department}
                    onChange={e => setDesigForm(p => ({ ...p, department: e.target.value }))}
                  >
                    <option value="">Select department</option>
                    {depts.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => createDesigMut.mutate(desigForm)}
                  disabled={createDesigMut.isPending}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  {createDesigMut.isPending ? 'Adding...' : 'Add Designation'}
                </button>
                <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Staff Tab */}
      {activeTab === 'staff' && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Staff Members ({staffList.length})</h3>
            <button onClick={() => {
              setShowForm(true)
              setStaffForm(p => ({ ...p, employee_id: nextIdRes?.data?.next_employee_id || '' }))
            }} className="text-xs text-sky-600 hover:text-sky-700">+ Add Staff</button>
          </div>

          {staffList.length > 0 && (
            <div className="overflow-auto max-h-48 mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Department</th>
                    <th className="py-2 pr-3">Designation</th>
                    <th className="py-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {staffList.slice(0, 30).map(s => (
                    <tr key={s.id} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 text-gray-800">{s.first_name} {s.last_name}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{s.department_name || '—'}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{s.designation_name || '—'}</td>
                      <td className="py-1.5 text-gray-500 text-xs">{s.employment_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showForm && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={staffForm.first_name}
                    onChange={e => { setStaffForm(p => ({ ...p, first_name: e.target.value })); setErrors({}) }}
                  />
                  {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input
                    type="text"
                    className="input"
                    value={staffForm.last_name}
                    onChange={e => setStaffForm(p => ({ ...p, last_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Employee ID</label>
                  <input
                    type="text"
                    className="input"
                    value={staffForm.employee_id}
                    onChange={e => setStaffForm(p => ({ ...p, employee_id: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                  <select
                    className="input"
                    value={staffForm.department}
                    onChange={e => setStaffForm(p => ({ ...p, department: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Designation</label>
                  <select
                    className="input"
                    value={staffForm.designation}
                    onChange={e => setStaffForm(p => ({ ...p, designation: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {desigs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Employment Type</label>
                  <select
                    className="input"
                    value={staffForm.employment_type}
                    onChange={e => setStaffForm(p => ({ ...p, employment_type: e.target.value }))}
                  >
                    <option value="FULL_TIME">Full Time</option>
                    <option value="PART_TIME">Part Time</option>
                    <option value="CONTRACT">Contract</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input
                    type="email"
                    className="input"
                    value={staffForm.email}
                    onChange={e => setStaffForm(p => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input
                    type="text"
                    className="input"
                    value={staffForm.phone}
                    onChange={e => setStaffForm(p => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
                  <select
                    className="input"
                    value={staffForm.gender}
                    onChange={e => setStaffForm(p => ({ ...p, gender: e.target.value }))}
                  >
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => createStaffMut.mutate(staffForm)}
                  disabled={createStaffMut.isPending}
                  className="btn-primary px-4 py-1.5 text-sm"
                >
                  {createStaffMut.isPending ? 'Adding...' : 'Add Staff Member'}
                </button>
                <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
