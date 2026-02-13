import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi, classesApi } from '../../services/api'

// Recommendation badge component
function RecBadge({ rec }) {
  const styles = {
    PROMOTE: 'bg-green-100 text-green-800 border-green-200',
    NEEDS_REVIEW: 'bg-amber-100 text-amber-800 border-amber-200',
    RETAIN: 'bg-red-100 text-red-800 border-red-200',
  }
  const labels = { PROMOTE: 'Promote', NEEDS_REVIEW: 'Needs Review', RETAIN: 'Retain' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[rec] || 'bg-gray-100 text-gray-700'}`}>
      {labels[rec] || rec}
    </span>
  )
}

// Confidence bar component
function ConfidenceBar({ value }) {
  const color = value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-500">{value}%</span>
    </div>
  )
}

// Trend indicator
function TrendIndicator({ trend }) {
  if (trend === 'improving') return <span className="text-green-600 text-xs font-medium">Improving</span>
  if (trend === 'declining') return <span className="text-red-600 text-xs font-medium">Declining</span>
  if (trend === 'stable') return <span className="text-gray-600 text-xs font-medium">Stable</span>
  return <span className="text-gray-400 text-xs">N/A</span>
}

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

  // AI Advisor state
  const [showAdvisor, setShowAdvisor] = useState(false)
  const [advisorOverrides, setAdvisorOverrides] = useState({}) // { student_id: 'PROMOTE' | 'RETAIN' | 'NEEDS_REVIEW' }

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

  // AI Promotion Advisor query
  const { data: advisorRes, isLoading: advisorLoading, refetch: refetchAdvisor } = useQuery({
    queryKey: ['promotionAdvisor', sourceYearId, sourceClassId],
    queryFn: () => sessionsApi.getPromotionAdvice({ academic_year: sourceYearId, class_id: sourceClassId }),
    enabled: false, // Only fetch on demand
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []
  const enrollments = enrollmentsRes?.data?.results || enrollmentsRes?.data || []
  const advisorData = advisorRes?.data || null
  const recommendations = advisorData?.recommendations || []

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

  // AI Advisor helpers
  const handleFetchAdvisor = () => {
    if (sourceYearId && sourceClassId) {
      setShowAdvisor(true)
      setAdvisorOverrides({})
      refetchAdvisor()
    }
  }

  const overrideRecommendation = (studentId, newRec) => {
    setAdvisorOverrides(prev => ({ ...prev, [studentId]: newRec }))
  }

  const getEffectiveRec = (r) => advisorOverrides[r.student_id] || r.recommendation

  const acceptAllRecommendations = (targetClassId) => {
    if (!targetClassId) {
      alert('Please select a target class first using "Set all target class" before accepting recommendations.')
      return
    }
    // Build promotions from advisor data
    const newPromotions = recommendations.map(r => {
      const effectiveRec = getEffectiveRec(r)
      return {
        student_id: r.student_id,
        student_name: r.student_name,
        current_class: r.class_name,
        current_roll: r.roll_number,
        target_class_id: effectiveRec === 'PROMOTE' ? targetClassId : '',
        new_roll_number: r.roll_number,
        include: effectiveRec === 'PROMOTE',
      }
    })
    setPromotions(newPromotions)
    setShowAdvisor(false)
    setStep(3)
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
              <div className="flex items-center gap-2">
                <button
                  onClick={handleFetchAdvisor}
                  disabled={!sourceClassId || advisorLoading}
                  className="px-4 py-2 text-sm rounded-lg border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  {advisorLoading ? 'Analyzing...' : 'AI Advisor'}
                </button>
                <button
                  onClick={initializePromotions}
                  disabled={!sourceClassId || enrollmentsLoading}
                  className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
                >{enrollmentsLoading ? 'Loading...' : 'Next'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Advisor Panel */}
      {showAdvisor && step === 2 && (
        <div className="mt-4">
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  AI Promotion Advisor
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Recommendations based on attendance, exams, fees & trends</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAdvisor(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >Close</button>
              </div>
            </div>

            {advisorLoading && (
              <div className="text-center py-12 text-gray-500">
                <div className="inline-block w-6 h-6 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin mb-3"></div>
                <p className="text-sm">Analyzing student data...</p>
              </div>
            )}

            {!advisorLoading && advisorData && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">{advisorData.summary?.promote || 0}</div>
                    <div className="text-xs text-green-600">Promote</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-700">{advisorData.summary?.needs_review || 0}</div>
                    <div className="text-xs text-amber-600">Needs Review</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-red-700">{advisorData.summary?.retain || 0}</div>
                    <div className="text-xs text-red-600">Retain</div>
                  </div>
                </div>

                {recommendations.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">No student data found for this class and academic year.</p>
                ) : (
                  <>
                    {/* Desktop Advisor Table */}
                    <div className="hidden lg:block overflow-x-auto mb-4">
                      <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200 text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <th className="px-3 py-2 text-left">Student</th>
                            <th className="px-3 py-2 text-left">Roll #</th>
                            <th className="px-3 py-2 text-center">Recommendation</th>
                            <th className="px-3 py-2 text-center">Confidence</th>
                            <th className="px-3 py-2 text-center">Attendance</th>
                            <th className="px-3 py-2 text-center">Avg Score</th>
                            <th className="px-3 py-2 text-center">Fees Paid</th>
                            <th className="px-3 py-2 text-center">Trend</th>
                            <th className="px-3 py-2 text-left">Risk Flags</th>
                            <th className="px-3 py-2 text-center">Override</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {recommendations.map(r => {
                            const effectiveRec = getEffectiveRec(r)
                            const isOverridden = advisorOverrides[r.student_id] !== undefined
                            return (
                              <tr key={r.student_id} className={`hover:bg-gray-50 ${isOverridden ? 'bg-blue-50/50' : ''}`}>
                                <td className="px-3 py-2 font-medium text-gray-900">{r.student_name}</td>
                                <td className="px-3 py-2 text-gray-600">{r.roll_number}</td>
                                <td className="px-3 py-2 text-center">
                                  <RecBadge rec={effectiveRec} />
                                  {isOverridden && <span className="block text-[10px] text-blue-500 mt-0.5">overridden</span>}
                                </td>
                                <td className="px-3 py-2 text-center"><ConfidenceBar value={r.confidence} /></td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-xs font-medium ${r.attendance_rate >= 75 ? 'text-green-600' : r.attendance_rate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {r.attendance_rate}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-xs font-medium ${r.average_score >= 50 ? 'text-green-600' : r.average_score >= 35 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {r.average_score}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-xs font-medium ${r.fee_paid_rate >= 75 ? 'text-green-600' : r.fee_paid_rate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {r.fee_paid_rate}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center"><TrendIndicator trend={r.trend} /></td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {r.risk_flags.length === 0 && <span className="text-xs text-green-500">None</span>}
                                    {r.risk_flags.map((flag, i) => (
                                      <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                        flag.startsWith('Critical') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                      }`}>{flag}</span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <select
                                    value={effectiveRec}
                                    onChange={e => overrideRecommendation(r.student_id, e.target.value)}
                                    className="input text-xs py-0.5 px-1 w-24"
                                  >
                                    <option value="PROMOTE">Promote</option>
                                    <option value="NEEDS_REVIEW">Review</option>
                                    <option value="RETAIN">Retain</option>
                                  </select>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Advisor Cards */}
                    <div className="lg:hidden space-y-3 mb-4">
                      {recommendations.map(r => {
                        const effectiveRec = getEffectiveRec(r)
                        const isOverridden = advisorOverrides[r.student_id] !== undefined
                        return (
                          <div key={r.student_id} className={`card border ${isOverridden ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{r.student_name}</p>
                                <p className="text-xs text-gray-500">Roll: {r.roll_number} | {r.class_name}</p>
                              </div>
                              <RecBadge rec={effectiveRec} />
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                              <div className="flex justify-between"><span className="text-gray-500">Attendance:</span><span className={r.attendance_rate >= 75 ? 'text-green-600' : r.attendance_rate >= 60 ? 'text-amber-600' : 'text-red-600'}>{r.attendance_rate}%</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Avg Score:</span><span className={r.average_score >= 50 ? 'text-green-600' : r.average_score >= 35 ? 'text-amber-600' : 'text-red-600'}>{r.average_score}%</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Fees Paid:</span><span className={r.fee_paid_rate >= 75 ? 'text-green-600' : 'text-amber-600'}>{r.fee_paid_rate}%</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Trend:</span><TrendIndicator trend={r.trend} /></div>
                              <div className="flex justify-between"><span className="text-gray-500">Confidence:</span><span>{r.confidence}%</span></div>
                            </div>
                            <p className="text-xs text-gray-600 italic mb-2">{r.reasoning}</p>
                            {r.risk_flags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {r.risk_flags.map((flag, i) => (
                                  <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    flag.startsWith('Critical') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                  }`}>{flag}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-gray-500">Override:</label>
                              <select
                                value={effectiveRec}
                                onChange={e => overrideRecommendation(r.student_id, e.target.value)}
                                className="input text-xs py-0.5 px-1 flex-1"
                              >
                                <option value="PROMOTE">Promote</option>
                                <option value="NEEDS_REVIEW">Review</option>
                                <option value="RETAIN">Retain</option>
                              </select>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Reasoning (desktop only, collapsible) */}
                    <details className="hidden lg:block mb-4">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Show detailed reasoning for all students</summary>
                      <div className="mt-2 space-y-1">
                        {recommendations.map(r => (
                          <div key={r.student_id} className="text-xs text-gray-600 flex gap-2">
                            <span className="font-medium text-gray-800 min-w-[120px]">{r.student_name}:</span>
                            <span className="italic">{r.reasoning}</span>
                          </div>
                        ))}
                      </div>
                    </details>

                    {/* Accept All Button */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>Target class for promoted students:</span>
                        <select id="advisor-target-class" className="input text-sm py-1 w-40">
                          <option value="">Select class...</option>
                          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => {
                          const sel = document.getElementById('advisor-target-class')
                          acceptAllRecommendations(sel?.value || '')
                        }}
                        className="btn-primary px-6 py-2 text-sm flex items-center justify-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Accept Recommendations & Proceed
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
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
