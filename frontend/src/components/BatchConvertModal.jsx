import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionsApi, sessionsApi } from '../services/api'
import ClassSelector from './ClassSelector'
import { useToast } from './Toast'

export default function BatchConvertModal({ enquiryIds, onClose, onSuccess }) {
  const { showError, showSuccess } = useToast()
  const queryClient = useQueryClient()
  const [academicYearId, setAcademicYearId] = useState('')
  const [classId, setClassId] = useState('')

  // Fetch academic years
  const { data: yearsRes, isLoading: yearsLoading } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 100 }),
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []

  // Convert mutation
  const convertMut = useMutation({
    mutationFn: (data) => admissionsApi.batchConvert(data),
    onSuccess: (res) => {
      const result = res?.data
      const count = result?.converted_count ?? 0
      const errors = result?.errors || []
      if (count > 0) {
        showSuccess(`${count} enquir${count === 1 ? 'y' : 'ies'} converted to students!`)
      }
      if (errors.length > 0) {
        showError(`${errors.length} failed: ${errors[0]?.error?.split('\n')[0] || 'Unknown error'}`)
      }
      queryClient.invalidateQueries({ queryKey: ['students'] })
      onSuccess()
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to convert enquiries')
    },
  })

  const handleConvert = () => {
    if (!academicYearId) {
      showError('Please select an academic year')
      return
    }
    if (!classId) {
      showError('Please select a class')
      return
    }
    convertMut.mutate({
      enquiry_ids: enquiryIds,
      academic_year_id: parseInt(academicYearId),
      class_id: parseInt(classId),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Convert to Students</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Convert <strong>{enquiryIds.length}</strong> confirmed enquir{enquiryIds.length === 1 ? 'y' : 'ies'} into
          students. Each student will be enrolled in the selected academic year and class.
        </p>

        <div className="space-y-4">
          {/* Academic Year */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Academic Year <span className="text-red-500">*</span>
            </label>
            {yearsLoading ? (
              <div className="text-sm text-gray-400">Loading...</div>
            ) : (
              <select
                value={academicYearId}
                onChange={(e) => setAcademicYearId(e.target.value)}
                className="input w-full"
              >
                <option value="">Select academic year...</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}{y.is_current ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Class */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Class <span className="text-red-500">*</span>
            </label>
            <ClassSelector
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="input w-full"
              required
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleConvert}
            disabled={convertMut.isPending || !academicYearId || !classId}
            className="btn-primary px-6 py-2 text-sm disabled:opacity-50 bg-purple-600 hover:bg-purple-700"
          >
            {convertMut.isPending ? 'Converting...' : `Convert ${enquiryIds.length} Enquiries`}
          </button>
        </div>
      </div>
    </div>
  )
}
