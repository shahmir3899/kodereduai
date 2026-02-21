import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'

export default function FeeSummaryCards({ summaryData }) {
  if (!summaryData) return null

  const collectionRate = summaryData.total_due > 0
    ? Math.round((summaryData.total_collected / summaryData.total_due) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      <div className="card">
        <p className="text-sm text-gray-500">Total Payable</p>
        <p className="text-xl font-bold text-gray-900">{Number(summaryData.total_due || 0).toLocaleString()}</p>
      </div>
      <div className="card">
        <p className="text-sm text-gray-500">Received</p>
        <p className="text-xl font-bold text-green-700">{Number(summaryData.total_collected || 0).toLocaleString()}</p>
      </div>
      <div className="card">
        <p className="text-sm text-gray-500">Balance</p>
        <p className="text-xl font-bold text-orange-700">{Number(summaryData.total_pending || 0).toLocaleString()}</p>
      </div>
      <div className="card">
        <p className="text-sm text-gray-500">Collection Rate</p>
        <p className="text-xl font-bold text-blue-700">{collectionRate}%</p>
      </div>
    </div>
  )
}

/**
 * Enhanced ClassBreakdown with expandable student-level detail rows.
 * Used by FeeOverviewPage. Pass `allPayments` to enable student expansion.
 * Falls back to non-expandable mode when `allPayments` is not provided.
 */
export function ClassBreakdown({ summaryData, allPayments, month, year, showCollectLink = false }) {
  const [expandedClasses, setExpandedClasses] = useState({})
  const byClass = summaryData?.by_class || []
  if (byClass.length === 0) return null

  const canExpand = !!allPayments

  const toggleClass = (classId) => {
    if (!canExpand) return
    setExpandedClasses(prev => ({ ...prev, [classId]: !prev[classId] }))
  }

  // Group payments by class for student-level expansion
  const paymentsByClass = {}
  if (canExpand) {
    allPayments.forEach(p => {
      const key = p.class_obj_id || p.class_name || 'unknown'
      if (!paymentsByClass[key]) paymentsByClass[key] = []
      paymentsByClass[key].push(p)
    })
    // Sort students by roll number within each class
    Object.values(paymentsByClass).forEach(students => {
      students.sort((a, b) => (parseInt(a.student_roll) || 0) - (parseInt(b.student_roll) || 0))
    })
  }

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Class-wise Breakdown</h3>

      {/* Mobile: cards */}
      <div className="sm:hidden space-y-2">
        {byClass.map((cls) => {
          const balance = Number(cls.total_due) - Number(cls.total_collected)
          const rate = cls.total_due > 0 ? Math.round((cls.total_collected / cls.total_due) * 100) : 0
          const classKey = cls.class_id || cls.class_name
          const isExpanded = expandedClasses[classKey]
          const students = paymentsByClass[classKey] || []
          return (
            <div key={classKey}>
              <div
                onClick={() => toggleClass(classKey)}
                className={`flex items-center justify-between py-2 px-3 border-b border-gray-100 last:border-0 ${canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {canExpand && (
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{cls.class_name}</p>
                    <p className="text-xs text-gray-500">{cls.count} students - {rate}%</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{Number(cls.total_due).toLocaleString()}</p>
                  <p className="text-xs">
                    <span className="text-green-700">{Number(cls.total_collected).toLocaleString()}</span>
                    {balance > 0 && <span className="text-orange-700 ml-2">-{balance.toLocaleString()}</span>}
                  </p>
                </div>
              </div>
              {isExpanded && students.length > 0 && (
                <div className="ml-6 mb-2 space-y-1">
                  {students.map(s => {
                    const sBal = Number(s.amount_due) - Number(s.amount_paid)
                    return (
                      <div key={s.id} className="flex items-center justify-between py-1 px-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 w-6">#{s.student_roll}</span>
                          <span className="text-gray-900">{s.student_name}</span>
                          <span className={`px-1.5 py-0.5 rounded ${
                            s.status === 'PAID' ? 'bg-green-100 text-green-700' :
                            s.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' :
                            s.status === 'UNPAID' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                          }`}>{s.status}</span>
                        </div>
                        <span className={sBal > 0 ? 'text-orange-700 font-medium' : 'text-green-700'}>{sBal > 0 ? sBal.toLocaleString() : 'Paid'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-gray-200">
              {canExpand && <th className="w-8 py-2"></th>}
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-2 pr-4">Class</th>
              <th className="text-center text-xs font-medium text-gray-500 uppercase py-2 px-4">Students</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Total Fee</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Received</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Balance</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 pl-4">Rate</th>
            </tr>
          </thead>
          <tbody>
            {byClass.map((cls) => {
              const balance = Number(cls.total_due) - Number(cls.total_collected)
              const rate = cls.total_due > 0 ? Math.round((cls.total_collected / cls.total_due) * 100) : 0
              const classKey = cls.class_id || cls.class_name
              const isExpanded = expandedClasses[classKey]
              const students = paymentsByClass[classKey] || []
              return (
                <Fragment key={classKey}>
                  <tr
                    onClick={() => toggleClass(classKey)}
                    className={`border-b border-gray-100 last:border-0 ${canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  >
                    {canExpand && (
                      <td className="py-2 pr-1">
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </td>
                    )}
                    <td className="py-2 pr-4 text-sm font-medium text-gray-900">{cls.class_name}</td>
                    <td className="py-2 px-4 text-sm text-gray-500 text-center">{cls.count}</td>
                    <td className="py-2 px-4 text-sm text-gray-900 text-right">{Number(cls.total_due).toLocaleString()}</td>
                    <td className="py-2 px-4 text-sm text-green-700 text-right">{Number(cls.total_collected).toLocaleString()}</td>
                    <td className={`py-2 px-4 text-sm font-medium text-right ${balance > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                      {balance.toLocaleString()}
                    </td>
                    <td className={`py-2 pl-4 text-sm font-medium text-right ${rate >= 80 ? 'text-green-700' : rate >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>
                      {rate}%
                    </td>
                  </tr>
                  {isExpanded && students.map(s => {
                    const prevBal = Number(s.previous_balance || 0)
                    const sBal = Number(s.amount_due) - Number(s.amount_paid)
                    return (
                      <tr key={s.id} className="bg-gray-50/50">
                        {canExpand && <td></td>}
                        <td className="py-1.5 pr-4 pl-4 text-xs text-gray-500">
                          <span className="text-gray-400 mr-2">#{s.student_roll}</span>
                          {s.student_name}
                        </td>
                        <td className="py-1.5 px-4 text-xs text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                            s.status === 'PAID' ? 'bg-green-100 text-green-700' :
                            s.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' :
                            s.status === 'UNPAID' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                          }`}>{s.status}</span>
                        </td>
                        <td className="py-1.5 px-4 text-xs text-gray-500 text-right">
                          {Number(s.amount_due).toLocaleString()}
                          {prevBal > 0 && <span className="text-orange-600 ml-1">(+{prevBal.toLocaleString()})</span>}
                        </td>
                        <td className="py-1.5 px-4 text-xs text-green-700 text-right">{Number(s.amount_paid).toLocaleString()}</td>
                        <td className={`py-1.5 px-4 text-xs font-medium text-right ${sBal > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                          {sBal > 0 ? sBal.toLocaleString() : 0}
                        </td>
                        <td className="py-1.5 pl-4 text-right">
                          {showCollectLink && s.status !== 'PAID' && s.status !== 'ADVANCE' && (
                            <Link
                              to={`/finance/fees/collect?student=${s.student_id || s.id}&month=${month}&year=${year}`}
                              className="text-xs text-primary-600 hover:text-primary-800"
                            >
                              Collect
                            </Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PendingStudents({ paymentList = [] }) {
  const [expandedClasses, setExpandedClasses] = useState({})

  const pendingStudents = paymentList.filter(p => p.status === 'UNPAID' || p.status === 'PARTIAL')
  const pendingByClass = {}
  pendingStudents.forEach(p => {
    const cls = p.class_name || 'Unknown'
    if (!pendingByClass[cls]) pendingByClass[cls] = []
    pendingByClass[cls].push(p)
  })
  const pendingTotal = pendingStudents.reduce((sum, p) => sum + (Number(p.amount_due) - Number(p.amount_paid)), 0)

  if (pendingStudents.length === 0) return null

  const toggleClass = (cls) => {
    setExpandedClasses(prev => ({ ...prev, [cls]: !prev[cls] }))
  }

  return (
    <div className="card border-l-4 border-l-orange-400">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Pending Students</h3>
        <div className="flex gap-3 text-xs">
          <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-medium">
            {pendingStudents.length} students
          </span>
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">
            {pendingTotal.toLocaleString()} due
          </span>
        </div>
      </div>

      <div className="space-y-1">
        {Object.entries(pendingByClass).map(([className, students]) => {
          const classTotal = students.reduce((sum, s) => sum + (Number(s.amount_due) - Number(s.amount_paid)), 0)
          const isExpanded = expandedClasses[className] !== false

          return (
            <div key={className}>
              <button
                onClick={() => toggleClass(className)}
                className="w-full flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm font-medium text-gray-900">{className}</span>
                  <span className="text-xs text-gray-500">({students.length})</span>
                </div>
                <span className="text-sm font-medium text-orange-700">{classTotal.toLocaleString()}</span>
              </button>

              {isExpanded && (
                <div className="ml-6 mt-1 mb-2 space-y-1">
                  {students.map((s) => {
                    const balance = Number(s.amount_due) - Number(s.amount_paid)
                    return (
                      <div key={s.id} className="flex items-center justify-between py-1.5 px-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs w-6">#{s.student_roll}</span>
                          <span className="text-gray-900">{s.student_name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            s.status === 'UNPAID' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                          }`}>
                            {s.status}
                          </span>
                        </div>
                        <span className="font-medium text-orange-700">{balance.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
