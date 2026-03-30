import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionsApi, classesApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useToast } from '../../components/Toast'

export default function SessionClassesStep({ refetchCompletion }) {
  const queryClient = useQueryClient()
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { addToast } = useToast()

  const { sessionClasses, isLoading } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)

  const { data: classesRes } = useQuery({
    queryKey: ['classes', activeSchool?.id],
    queryFn: () => classesApi.getClasses({ school_id: activeSchool?.id, page_size: 200 }),
    enabled: !!activeSchool?.id,
  })

  const masterClasses = classesRes?.data?.results || classesRes?.data || []

  const initializeMut = useMutation({
    mutationFn: () => sessionsApi.initializeSessionClasses({ academic_year: activeAcademicYear?.id }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      refetchCompletion?.()
      addToast(res?.data?.message || 'Session classes initialized for active academic year.', 'success')
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || 'Failed to initialize session classes.', 'error')
    },
  })

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Session Class Assignment</h2>
      <p className="text-sm text-gray-500 mb-6">
        Use master classes as the shared catalog, then create year-specific session classes and sections for the active academic year.
      </p>

      {!activeAcademicYear?.id ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800 font-medium">No active academic year selected.</p>
          <p className="text-xs text-amber-700 mt-1">
            Complete the Academic Year step first, then set one year as current from the session switcher.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border p-5 mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Current Status</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs">Active Academic Year</p>
                <p className="font-semibold text-gray-900 mt-0.5">{activeAcademicYear.name}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs">Master Classes</p>
                <p className="font-semibold text-gray-900 mt-0.5">{masterClasses.length}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs">Session Classes</p>
                <p className="font-semibold text-gray-900 mt-0.5">
                  {isLoading ? 'Loading...' : sessionClasses.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
            <p className="text-xs text-blue-800">
              Why this matters: keep master classes simple and section-free, then create sections inside session classes for each academic year.
              This keeps class filters, counts, and promotions year-specific without duplicating the master catalog.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => initializeMut.mutate()}
              disabled={initializeMut.isPending || !activeAcademicYear?.id}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {initializeMut.isPending ? 'Initializing...' : 'Initialize Session Classes From Master'}
            </button>
            {sessionClasses.length > 0 && (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
                Session assignment configured for this year.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
