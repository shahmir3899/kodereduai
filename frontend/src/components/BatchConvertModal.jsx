import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionsApi, sessionsApi } from '../services/api'
import ClassSelector from './ClassSelector'
import { useToast } from './Toast'

const FEE_TYPE_OPTIONS = [
  { value: 'ADMISSION', label: 'Admission Fee (one-time)' },
  { value: 'ANNUAL', label: 'Annual Fee (yearly)' },
  { value: 'BOOKS', label: 'Books Fee' },
  { value: 'MONTHLY', label: 'Monthly Fee (current month)' },
]

export default function BatchConvertModal({ enquiryIds, onClose, onSuccess }) {
  const { showError, showSuccess } = useToast()
  const queryClient = useQueryClient()
  const [academicYearId, setAcademicYearId] = useState('')
  const [classId, setClassId] = useState('')
  const [generateFees, setGenerateFees] = useState(false)
  const [selectedFeeTypes, setSelectedFeeTypes] = useState(['ADMISSION', 'ANNUAL'])

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
      const feesCount = result?.fees_generated_count ?? 0
      const errors = result?.errors || []
      if (count > 0) {
        const feeMsg = feesCount > 0 ? ` with ${feesCount} fee record${feesCount === 1 ? '' : 's'}` : ''
        showSuccess(`${count} enquir${count === 1 ? 'y' : 'ies'} converted to students${feeMsg}!`)
      }
      if (errors.length > 0) {
        showError(`${errors.length} failed: ${errors[0]?.error?.split('\n')[0] || 'Unknown error'}`)
      }
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      onSuccess()
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to convert enquiries')
    },
  })

  const handleFeeTypeToggle = (value) => {
    setSelectedFeeTypes(prev =>
      prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]
    )
  }

  const handleConvert = () => {
    if (!academicYearId) {
      showError('Please select an academic year')
      return
    }
    if (!classId) {
      showError('Please select a class')
      return
    }
    if (generateFees && selectedFeeTypes.length === 0) {
      showError('Please select at least one fee type')
      return
    }
    convertMut.mutate({
      enquiry_ids: enquiryIds,
      academic_year_id: parseInt(academicYearId),
      class_id: parseInt(classId),
      generate_fees: generateFees,
      fee_types: generateFees ? selectedFeeTypes : [],
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

          {/* Fee Generation */}
          <div className="border-t border-gray-200 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={generateFees}
                onChange={(e) => setGenerateFees(e.target.checked)}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm font-medium text-gray-700">Auto-generate fee records</span>
            </label>

            {generateFees && (
              <div className="mt-3 ml-6 space-y-2">
                <p className="text-xs text-gray-500">Select fee types to generate:</p>
                {FEE_TYPE_OPTIONS.map(ft => (
                  <label key={ft.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedFeeTypes.includes(ft.value)}
                      onChange={() => handleFeeTypeToggle(ft.value)}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-600">{ft.label}</span>
                  </label>
                ))}
                <p className="text-xs text-gray-400 mt-1">
                  Fee structures must be configured in Finance for the selected class.
                </p>
              </div>
            )}
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
