import { useMemo, useState } from 'react'
import Modal from '../../components/ui/Modal'
import Field from '../../components/ui/Field'
import Badge from '../../components/ui/Badge'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostelApi, studentsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useDebounce } from '../../hooks/useDebounce'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'
import StudentPicker from './StudentPicker'

function formatDate(dateStr) {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const emptyAllocationForm = {
  student: '',
  hostel: '',
  room: '',
  academic_year: '',
}

export default function HostelAllocationsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { academicYears, activeAcademicYear } = useAcademicYear()

  const [view, setView] = useViewPreference('hostel-allocations')
  const [hostelFilter, setHostelFilter] = useState('')
  // 'active' | 'vacated' | '' (all). The API filters on is_active, not a status name.
  const [statusFilter, setStatusFilter] = useState('active')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const [showModal, setShowModal] = useState(false)
  const [allocationForm, setAllocationForm] = useState(emptyAllocationForm)
  const [vacateConfirm, setVacateConfirm] = useState(null)

  const { data: allocationsData, isLoading, error } = useQuery({
    queryKey: ['hostelAllocations', hostelFilter, statusFilter, debouncedSearch],
    queryFn: () => hostelApi.getAllocations({
      hostel_id: hostelFilter || undefined,
      is_active: statusFilter ? String(statusFilter === 'active') : undefined,
      search: debouncedSearch || undefined,
      page_size: 9999,
    }),
  })

  const { data: hostelsData } = useQuery({
    queryKey: ['hostels'],
    queryFn: () => hostelApi.getHostels({ page_size: 9999 }),
  })

  const { data: roomsData } = useQuery({
    queryKey: ['hostelRooms', allocationForm.hostel],
    queryFn: () => hostelApi.getRooms({ hostel_id: allocationForm.hostel, page_size: 9999 }),
    enabled: showModal && !!allocationForm.hostel,
  })

  // Roster for the picker, and who already holds a bed this year so they are not offered twice.
  const { data: studentsData } = useQuery({
    queryKey: ['hostel-students', allocationForm.academic_year],
    queryFn: () => studentsApi.getStudents({
      page_size: 9999,
      ...(allocationForm.academic_year && { academic_year: allocationForm.academic_year }),
    }),
    enabled: showModal,
  })

  const { data: activeData } = useQuery({
    queryKey: ['hostelAllocations', 'active-ids'],
    queryFn: () => hostelApi.getAllocations({ is_active: 'true', page_size: 9999 }),
    enabled: showModal,
  })

  const allocations = allocationsData?.data?.results || allocationsData?.data || []
  const hostels = hostelsData?.data?.results || hostelsData?.data || []
  const rooms = roomsData?.data?.results || roomsData?.data || []
  const students = studentsData?.data?.results || studentsData?.data || []
  const activeAllocations = activeData?.data?.results || activeData?.data || []

  const housedIds = useMemo(
    () => new Set(
      activeAllocations
        .filter((a) => !allocationForm.academic_year || String(a.academic_year) === String(allocationForm.academic_year))
        .map((a) => a.student),
    ),
    [activeAllocations, allocationForm.academic_year],
  )

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['hostelAllocations'] })
    queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
    queryClient.invalidateQueries({ queryKey: ['hostels'] })
    queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
  }

  const createAllocationMutation = useMutation({
    mutationFn: (data) => hostelApi.createAllocation(data),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Student allocated')
      closeModal()
    },
  })

  const vacateAllocationMutation = useMutation({
    mutationFn: (id) => hostelApi.vacateAllocation(id),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Student vacated')
      closeVacate()
    },
  })

  const openModal = () => {
    setAllocationForm({ ...emptyAllocationForm, academic_year: activeAcademicYear?.id?.toString() || '' })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setAllocationForm(emptyAllocationForm)
    createAllocationMutation.reset()
  }

  const closeVacate = () => {
    setVacateConfirm(null)
    vacateAllocationMutation.reset()
  }

  useEscapeKey(closeModal, showModal)
  useEscapeKey(closeVacate, !!vacateConfirm)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!allocationForm.student) {
      toast.showError('Choose a student')
      return
    }
    createAllocationMutation.mutate({
      student: parseInt(allocationForm.student),
      room: parseInt(allocationForm.room),
      academic_year: parseInt(allocationForm.academic_year),
    })
  }

  const statusBadge = (alloc) => (
    <Badge tone={alloc.is_active ? 'success' : 'neutral'}>{alloc.is_active ? 'Active' : 'Vacated'}</Badge>
  )

  const filtersActive = !!(hostelFilter || statusFilter || search)

  return (
    <div>
      <PageHeader title="Room Allocations" subtitle="Manage student-to-room allocations" className="mb-6" actions={
        <button onClick={openModal} className="btn btn-primary">Allocate Student</button>
      } />

      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Search">
            <input
              type="search"
              className="input"
              placeholder="Student name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Hostel">
            <select className="input" value={hostelFilter} onChange={(e) => setHostelFilter(e.target.value)}>
              <option value="">All Hostels</option>
              {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="vacated">Vacated</option>
            </select>
          </Field>
        </div>
      </div>

      {error ? (
        <div className="card text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load allocations</h3>
          <p className="text-gray-500">{getErrorMessage(error, 'Something went wrong.')}</p>
        </div>
      ) : (
        <div className="card">
          {isLoading ? (
            <div className="text-center py-8">
              <LoadingState label="Loading allocations..." compact />
            </div>
          ) : allocations.length === 0 ? (
            <EmptyState
              title="No allocations found"
              description={filtersActive ? 'Try adjusting your filters.' : 'Allocate your first student to get started.'}
            />
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <ViewToggle view={view} onChange={setView} />
              </div>

              {view === 'cards' ? (
                <CardGrid>
                  {allocations.map((alloc) => (
                    <RecordCard
                      key={alloc.id}
                      title={alloc.student_name}
                      meta={alloc.student_class_name || '--'}
                      status={statusBadge(alloc)}
                      fields={[
                        { label: 'Hostel', value: alloc.hostel_name },
                        { label: 'Room', value: alloc.room_number },
                        { label: 'Year', value: alloc.academic_year_name },
                        { label: 'Allocated', value: formatDate(alloc.allocated_date) },
                        ...(alloc.vacated_date ? [{ label: 'Vacated', value: formatDate(alloc.vacated_date) }] : []),
                      ]}
                      actions={alloc.is_active ? [
                        { label: 'Vacate', tone: 'danger', onClick: () => setVacateConfirm(alloc) },
                      ] : []}
                    />
                  ))}
                </CardGrid>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hostel / Room</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic Year</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Allocated</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {allocations.map((alloc) => (
                        <tr key={alloc.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm">
                            <p className="font-medium text-gray-900">{alloc.student_name}</p>
                            <p className="text-xs text-gray-500">{alloc.student_class_name || '--'}</p>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{alloc.hostel_name} / Room {alloc.room_number}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{alloc.academic_year_name}</td>
                          <td className="px-4 py-3 text-center">{statusBadge(alloc)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                            {formatDate(alloc.allocated_date)}
                            {alloc.vacated_date && <p className="text-xs">Left {formatDate(alloc.vacated_date)}</p>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {alloc.is_active && (
                              <button
                                onClick={() => setVacateConfirm(alloc)}
                                className="text-sm text-red-600 hover:text-red-800 font-medium"
                              >
                                Vacate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ============ Allocate Student Modal ============ */}
      {showModal && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">Allocate Student</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Academic Year" required>
              <select
                required
                className="input"
                value={allocationForm.academic_year}
                onChange={(e) => setAllocationForm({ ...allocationForm, academic_year: e.target.value, student: '' })}
              >
                <option value="">-- Select Academic Year --</option>
                {academicYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </Field>

            <Field label="Student" required>
              <StudentPicker
                students={students}
                excludeIds={housedIds}
                value={allocationForm.student}
                onChange={(student) => setAllocationForm({ ...allocationForm, student })}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Hostel" required>
                <select
                  required
                  className="input"
                  value={allocationForm.hostel}
                  onChange={(e) => setAllocationForm({ ...allocationForm, hostel: e.target.value, room: '' })}
                >
                  <option value="">-- Select Hostel --</option>
                  {hostels.filter((h) => h.is_active).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </Field>
              <Field
                label="Room"
                required
                hint={!allocationForm.hostel ? 'Select a hostel first to see available rooms.' : undefined}
              >
                <select
                  required
                  className="input"
                  value={allocationForm.room}
                  onChange={(e) => setAllocationForm({ ...allocationForm, room: e.target.value })}
                  disabled={!allocationForm.hostel}
                >
                  <option value="">-- Select Room --</option>
                  {rooms
                    .filter((r) => r.is_available && !r.is_full)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} (Floor {r.floor}, {r.current_occupancy}/{r.capacity} beds taken)
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            {createAllocationMutation.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {getErrorMessage(createAllocationMutation.error, 'Failed to allocate student. Please try again.')}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={closeModal} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={createAllocationMutation.isPending} className="btn btn-primary">
                {createAllocationMutation.isPending ? 'Allocating...' : 'Allocate'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ============ Vacate Confirmation Modal ============ */}
      {vacateConfirm && (
        <Modal open size="sm" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Vacate Student</h2>
          <p className="text-gray-600 mb-4">
            Are you sure you want to vacate <strong>{vacateConfirm.student_name}</strong> from Room{' '}
            <strong>{vacateConfirm.room_number}</strong>?
          </p>

          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Hostel:</span>
              <span className="font-medium text-gray-900">{vacateConfirm.hostel_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Allocated:</span>
              <span className="font-medium text-gray-900">{formatDate(vacateConfirm.allocated_date)}</span>
            </div>
          </div>

          {vacateAllocationMutation.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {getErrorMessage(vacateAllocationMutation.error, 'Failed to vacate.')}
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button onClick={closeVacate} className="btn btn-secondary">Cancel</button>
            <button
              onClick={() => vacateAllocationMutation.mutate(vacateConfirm.id)}
              disabled={vacateAllocationMutation.isPending}
              className="btn btn-danger"
            >
              {vacateAllocationMutation.isPending ? 'Processing...' : 'Vacate'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
