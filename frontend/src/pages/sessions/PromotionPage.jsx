import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi, classesApi } from '../../services/api'

export default function PromotionPage() {
  const queryClient = useQueryClient()

  // Step state
  const [step, setStep] = useState(1) // 1: Select years, 2: Select class, 3: Review & promote

  // Selection state
  const [sourceYearId, setSourceYearId] = useState('')
  const [targetYearId, setTargetYearId] = useState('')
  const [sourceClassId, setSourceClassId] = useState('')

  // Promotion data
  const [promotions, setPromotions] = useState([])
  const [result, setResult] = useState(null)

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears(),
  })

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
  })

  const { data: enrollmentsRes, isLoading: enrollmentsLoading } = useQuery({
    queryKey: ['enrollmentsByClass', sourceClassId, sourceYearId],
    queryFn: () => sessionsApi.getEnrollmentsByClass({ class_id: sourceClassId, academic_year_id: sourceYearId }),
    enabled: !!sourceClassId && !!sourceYearId && step >= 2,
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []
  const enrollments = enrollmentsRes?.data?.results || enrollmentsRes?.data || []

  // Bulk promote mutation
  const promoteMut = useMutation({
    mutationFn: (data) => sessionsApi.bulkPromote(data),
    onSuccess: (res) => {
      setResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['enrollments'] })
      queryClient.invalidateQueries({ queryKey: ['enrollmentsByClass'] })
    },
    onError: (err) => {
      setResult({ error: err.response?.data?.detail || 'Promotion failed' })
    },
  })

  // Initialize promotions when enrollments load
  const initializePromotions = () => {
    if (enrollments.length > 0) {
      setPromotions(enrollments.map(e => ({
        student_id: e.student,
        student_name: e.student_name,
        current_class: e.class_name,
        current_roll: e.roll_number,
        target_class_id: '',
        new_roll_number: e.roll_number,
        include: true,
      })))
      setStep(3)
    }
  }

  const handlePromote = () => {
    const included = promotions.filter(p => p.include && p.target_class_id)
    if (included.length === 0) {
      alert('Please select target classes for at least one student.')
      return
    }

    promoteMut.mutate({
      source_academic_year_id: parseInt(sourceYearId),
      target_academic_year_id: parseInt(targetYearId),
      promotions: included.map(p => ({
        student_id: p.student_id,
        target_class_id: parseInt(p.target_class_id),
        new_roll_number: p.new_roll_number,
      })),
    })
  }

  const updatePromotion = (idx, field, value) => {
    setPromotions(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }

  const setAllTargetClass = (classId) => {
    setPromotions(prev => prev.map(p => ({ ...p, target_class_id: classId })))
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Student Promotion</h1>
        <p className="text-sm text-gray-600">Promote students from one academic year to the next</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= s ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>{s}</div>
            <span className={`text-sm hidden sm:inline ${step >= s ? 'text-primary-700 font-medium' : 'text-gray-400'}`}>
              {s === 1 ? 'Select Years' : s === 2 ? 'Select Class' : 'Review & Promote'}
            </span>
            {s < 3 && <div className="w-8 h-0.5 bg-gray-200"></div>}
          </div>
        ))}
      </div>

      {/* Step 1: Select Years */}
      {step === 1 && (
        <div className="card max-w-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Academic Years</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source Year (promote from) *</label>
              <select value={sourceYearId} onChange={e => setSourceYearId(e.target.value)} className="input w-full">
                <option value="">Select source year...</option>
                {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Year (promote to) *</label>
              <select value={targetYearId} onChange={e => setTargetYearId(e.target.value)} className="input w-full">
                <option value="">Select target year...</option>
                {years.filter(y => y.id !== parseInt(sourceYearId)).map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!sourceYearId || !targetYearId}
                className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
              >Next</button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Select Class */}
      {step === 2 && (
        <div className="card max-w-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Source Class</h2>
          <p className="text-sm text-gray-500 mb-4">
            Promoting from <strong>{years.find(y => y.id === parseInt(sourceYearId))?.name}</strong> to <strong>{years.find(y => y.id === parseInt(targetYearId))?.name}</strong>
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
              <select value={sourceClassId} onChange={e => setSourceClassId(e.target.value)} className="input w-full">
                <option value="">Select class...</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
              <button
                onClick={initializePromotions}
                disabled={!sourceClassId || enrollmentsLoading}
                className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
              >{enrollmentsLoading ? 'Loading...' : 'Next'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Review & Promote */}
      {step === 3 && !result && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Review Promotions</h2>
              <p className="text-xs text-gray-500">{promotions.filter(p => p.include).length} of {promotions.length} students selected</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Set all target class:</label>
              <select onChange={e => setAllTargetClass(e.target.value)} className="input text-sm py-1">
                <option value="">--</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {promotions.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">
              No students enrolled in this class for the selected academic year.
              <button onClick={() => setStep(2)} className="block mx-auto mt-3 text-primary-600 text-sm hover:underline">Go Back</button>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto mb-4">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-3 text-center">Include</th>
                      <th className="px-3 py-3 text-left">Student</th>
                      <th className="px-3 py-3 text-left">Current Class</th>
                      <th className="px-3 py-3 text-left">Target Class</th>
                      <th className="px-3 py-3 text-left">New Roll #</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {promotions.map((p, idx) => (
                      <tr key={idx} className={`${p.include ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}`}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.include}
                            onChange={e => updatePromotion(idx, 'include', e.target.checked)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{p.student_name}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">{p.current_class}</td>
                        <td className="px-3 py-2">
                          <select
                            value={p.target_class_id}
                            onChange={e => updatePromotion(idx, 'target_class_id', e.target.value)}
                            className="input text-sm py-1 w-40"
                            disabled={!p.include}
                          >
                            <option value="">Select...</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={p.new_roll_number}
                            onChange={e => updatePromotion(idx, 'new_roll_number', e.target.value)}
                            className="input text-sm py-1 w-24"
                            disabled={!p.include}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3 mb-4">
                {promotions.map((p, idx) => (
                  <div key={idx} className={`card ${!p.include ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <input
                        type="checkbox"
                        checked={p.include}
                        onChange={e => updatePromotion(idx, 'include', e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{p.student_name}</p>
                        <p className="text-xs text-gray-500">Current: {p.current_class}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Target Class</label>
                        <select
                          value={p.target_class_id}
                          onChange={e => updatePromotion(idx, 'target_class_id', e.target.value)}
                          className="input text-sm py-1 w-full"
                          disabled={!p.include}
                        >
                          <option value="">Select...</option>
                          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Roll #</label>
                        <input
                          type="text"
                          value={p.new_roll_number}
                          onChange={e => updatePromotion(idx, 'new_roll_number', e.target.value)}
                          className="input text-sm py-1 w-full"
                          disabled={!p.include}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
                <button
                  onClick={handlePromote}
                  disabled={promoteMut.isPending}
                  className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
                >{promoteMut.isPending ? 'Promoting...' : 'Promote Students'}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card max-w-lg">
          {result.error ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                <span className="text-red-600 text-xl">!</span>
              </div>
              <h3 className="text-lg font-semibold text-red-700 mb-2">Promotion Failed</h3>
              <p className="text-sm text-gray-600">{result.error}</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-green-700 mb-2">Promotion Complete</h3>
              <p className="text-sm text-gray-600 mb-4">{result.promoted_count || result.promoted || 0} student(s) promoted successfully.</p>
            </div>
          )}
          <div className="flex justify-center mt-4">
            <button
              onClick={() => { setResult(null); setStep(1); setPromotions([]) }}
              className="btn-primary px-6 py-2 text-sm"
            >Start New Promotion</button>
          </div>
        </div>
      )}
    </div>
  )
}
