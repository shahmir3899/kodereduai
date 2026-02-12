import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const EMPTY_FORM = {
  staff_member: '',
  basic_salary: '',
  allowances: {},
  deductions: {},
  effective_from: '',
  effective_to: '',
}

function KeyValueEditor({ label, value, onChange }) {
  const entries = Object.entries(value || {})

  const handleAdd = () => {
    onChange({ ...value, '': 0 })
  }

  const handleRemove = (key) => {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  const handleKeyChange = (oldKey, newKey) => {
    const next = {}
    for (const [k, v] of Object.entries(value)) {
      next[k === oldKey ? newKey : k] = v
    }
    onChange(next)
  }

  const handleValueChange = (key, newVal) => {
    onChange({ ...value, [key]: parseFloat(newVal) || 0 })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="label mb-0">{label}</label>
        <button type="button" onClick={handleAdd} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          + Add
        </button>
      </div>
      {entries.length === 0 && (
        <p className="text-xs text-gray-400 italic">No items added</p>
      )}
      <div className="space-y-2">
        {entries.map(([key, val], idx) => (
          <div key={idx} className="flex gap-2 items-center">
            <input
              type="text"
              className="input flex-1"
              placeholder="Name (e.g. house_rent)"
              value={key}
              onChange={(e) => handleKeyChange(key, e.target.value)}
            />
            <input
              type="number"
              className="input w-28"
              placeholder="Amount"
              value={val}
              onChange={(e) => handleValueChange(key, e.target.value)}
            />
            <button
              type="button"
              onClick={() => handleRemove(key)}
              className="text-red-500 hover:text-red-700 text-lg font-bold px-1"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SalaryManagementPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)

  // Fetch salary structures
  const { data: salaryData, isLoading } = useQuery({
    queryKey: ['hrSalaryStructures'],
    queryFn: () => hrApi.getSalaryStructures(),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch staff for dropdown
  const { data: staffData } = useQuery({
    queryKey: ['hrStaff'],
    queryFn: () => hrApi.getStaff(),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch departments for filter
  const { data: deptData } = useQuery({
    queryKey: ['hrDepartments'],
    queryFn: () => hrApi.getDepartments(),
    staleTime: 5 * 60 * 1000,
  })

  const [departmentFilter, setDepartmentFilter] = useState('')

  const createMutation = useMutation({
    mutationFn: (data) => hrApi.createSalaryStructure(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['hrSalaryStructures'])
      showSuccess('Salary structure created!')
      closeModal()
    },
    onError: (err) => showError(err.response?.data?.detail || err.response?.data?.non_field_errors?.[0] || 'Failed to create salary structure'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateSalaryStructure(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['hrSalaryStructures'])
      showSuccess('Salary structure updated!')
      closeModal()
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to update salary structure'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => hrApi.deleteSalaryStructure(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['hrSalaryStructures'])
      showSuccess('Salary structure deactivated!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete'),
  })

  const allSalaries = salaryData?.data?.results || salaryData?.data || []
  const allStaff = staffData?.data?.results || staffData?.data || []
  const departments = deptData?.data?.results || deptData?.data || []

  const filteredSalaries = useMemo(() => {
    let result = allSalaries
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(
        (r) =>
          r.staff_member_name?.toLowerCase().includes(s) ||
          r.staff_employee_id?.toLowerCase().includes(s)
      )
    }
    if (departmentFilter) {
      result = result.filter((r) => r.department_name === departmentFilter)
    }
    return result
  }, [allSalaries, search, departmentFilter])

  const openCreate = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (salary) => {
    setEditId(salary.id)
    setForm({
      staff_member: String(salary.staff_member),
      basic_salary: salary.basic_salary,
      allowances: salary.allowances || {},
      deductions: salary.deductions || {},
      effective_from: salary.effective_from || '',
      effective_to: salary.effective_to || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditId(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.staff_member || !form.basic_salary || !form.effective_from) {
      showError('Staff member, basic salary, and effective from date are required.')
      return
    }

    const payload = {
      staff_member: parseInt(form.staff_member),
      basic_salary: parseFloat(form.basic_salary),
      allowances: form.allowances,
      deductions: form.deductions,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
    }

    if (editId) {
      updateMutation.mutate({ id: editId, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const fmt = (v) => {
    const n = parseFloat(v)
    return isNaN(n) ? '0.00' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Salary Management</h1>
          <p className="text-sm text-gray-600">
            {filteredSalaries.length} salary structure{filteredSalaries.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openCreate} className="btn btn-primary">
          Add Salary Structure
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            className="input"
            placeholder="Search by staff name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : filteredSalaries.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          {allSalaries.length === 0
            ? 'No salary structures found. Add your first one to get started.'
            : 'No salary structures match your filters.'}
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="sm:hidden space-y-3">
            {filteredSalaries.map((s) => (
              <div key={s.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">{s.staff_member_name}</p>
                    {s.staff_employee_id && <p className="text-xs text-gray-500">ID: {s.staff_employee_id}</p>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 space-y-1">
                  {s.department_name && <p>Dept: {s.department_name}</p>}
                  <p>Basic: {fmt(s.basic_salary)}</p>
                  <p>Gross: {fmt(s.gross_salary)} | Net: {fmt(s.net_salary)}</p>
                  <p>Effective: {s.effective_from}{s.effective_to ? ` to ${s.effective_to}` : ' onwards'}</p>
                </div>
                <div className="flex justify-end gap-3 mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => openEdit(s)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                  <button onClick={() => deleteMutation.mutate(s.id)} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Staff Member</th>
                  <th className="pb-3 pr-4">Department</th>
                  <th className="pb-3 pr-4 text-right">Basic</th>
                  <th className="pb-3 pr-4 text-right">Gross</th>
                  <th className="pb-3 pr-4 text-right">Deductions</th>
                  <th className="pb-3 pr-4 text-right">Net</th>
                  <th className="pb-3 pr-4">Effective</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSalaries.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <p className="text-sm font-medium text-gray-900">{s.staff_member_name}</p>
                      {s.staff_employee_id && <p className="text-xs text-gray-500">{s.staff_employee_id}</p>}
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-600">{s.department_name || '—'}</td>
                    <td className="py-3 pr-4 text-sm text-gray-900 text-right">{fmt(s.basic_salary)}</td>
                    <td className="py-3 pr-4 text-sm text-green-700 text-right font-medium">{fmt(s.gross_salary)}</td>
                    <td className="py-3 pr-4 text-sm text-red-600 text-right">{fmt(s.total_deductions)}</td>
                    <td className="py-3 pr-4 text-sm text-gray-900 text-right font-semibold">{fmt(s.net_salary)}</td>
                    <td className="py-3 pr-4 text-sm text-gray-600">
                      {s.effective_from}{s.effective_to ? ` — ${s.effective_to}` : '+'}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEdit(s)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                        <button onClick={() => deleteMutation.mutate(s.id)} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editId ? 'Edit Salary Structure' : 'Add Salary Structure'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Staff Member *</label>
                <select
                  className="input"
                  value={form.staff_member}
                  onChange={(e) => setForm({ ...form, staff_member: e.target.value })}
                  disabled={!!editId}
                >
                  <option value="">Select Staff</option>
                  {allStaff.filter((s) => s.is_active && s.employment_status === 'ACTIVE').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.first_name} {s.last_name} {s.employee_id ? `(${s.employee_id})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Basic Salary *</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={form.basic_salary}
                  onChange={(e) => setForm({ ...form, basic_salary: e.target.value })}
                />
              </div>

              <KeyValueEditor
                label="Allowances"
                value={form.allowances}
                onChange={(v) => setForm({ ...form, allowances: v })}
              />

              <KeyValueEditor
                label="Deductions"
                value={form.deductions}
                onChange={(v) => setForm({ ...form, deductions: v })}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Effective From *</label>
                  <input
                    type="date"
                    className="input"
                    value={form.effective_from}
                    onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Effective To</label>
                  <input
                    type="date"
                    className="input"
                    value={form.effective_to}
                    onChange={(e) => setForm({ ...form, effective_to: e.target.value })}
                  />
                </div>
              </div>

              {/* Summary */}
              {form.basic_salary && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between">
                    <span>Basic</span>
                    <span>{fmt(form.basic_salary)}</span>
                  </div>
                  <div className="flex justify-between text-green-700">
                    <span>+ Allowances</span>
                    <span>{fmt(Object.values(form.allowances).reduce((a, b) => a + (parseFloat(b) || 0), 0))}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>- Deductions</span>
                    <span>{fmt(Object.values(form.deductions).reduce((a, b) => a + (parseFloat(b) || 0), 0))}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-gray-200 pt-1 mt-1">
                    <span>Net Salary</span>
                    <span>
                      {fmt(
                        (parseFloat(form.basic_salary) || 0) +
                        Object.values(form.allowances).reduce((a, b) => a + (parseFloat(b) || 0), 0) -
                        Object.values(form.deductions).reduce((a, b) => a + (parseFloat(b) || 0), 0)
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="btn btn-primary">
                  {isSubmitting ? 'Saving...' : editId ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
