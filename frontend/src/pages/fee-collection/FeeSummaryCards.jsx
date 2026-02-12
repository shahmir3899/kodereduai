import { useState } from 'react'

export default function FeeSummaryCards({ summaryData, paymentList = [] }) {
  if (!summaryData) return null

  const byClass = summaryData.by_class || []
  const collectionRate = summaryData.total_due > 0
    ? Math.round((summaryData.total_collected / summaryData.total_due) * 100)
    : 0

  // Pending students: filter UNPAID and PARTIAL, group by class
  const pendingStudents = paymentList.filter(p => p.status === 'UNPAID' || p.status === 'PARTIAL')
  const pendingByClass = {}
  pendingStudents.forEach(p => {
    const cls = p.class_name || 'Unknown'
    if (!pendingByClass[cls]) pendingByClass[cls] = []
    pendingByClass[cls].push(p)
  })
  const pendingTotal = pendingStudents.reduce((sum, p) => sum + (Number(p.amount_due) - Number(p.amount_paid)), 0)

  return (
    <div className="mb-6">
      {/* Overall totals */}
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

      {/* Class-wise breakdown */}
      {byClass.length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Class-wise Breakdown</h3>

          {/* Mobile: cards */}
          <div className="sm:hidden space-y-2">
            {byClass.map((cls) => {
              const balance = Number(cls.total_due) - Number(cls.total_collected)
              return (
                <div key={cls.class_id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{cls.class_name}</p>
                    <p className="text-xs text-gray-500">{cls.count} students</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">{Number(cls.total_due).toLocaleString()}</p>
                    <p className="text-xs">
                      <span className="text-green-700">{Number(cls.total_collected).toLocaleString()}</span>
                      {balance > 0 && <span className="text-orange-700 ml-2">-{balance.toLocaleString()}</span>}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2 pr-4">Class</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase py-2 px-4">Students</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Total Fee</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Received</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 pl-4">Balance</th>
                </tr>
              </thead>
              <tbody>
                {byClass.map((cls) => {
                  const balance = Number(cls.total_due) - Number(cls.total_collected)
                  return (
                    <tr key={cls.class_id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-4 text-sm font-medium text-gray-900">{cls.class_name}</td>
                      <td className="py-2 px-4 text-sm text-gray-500 text-center">{cls.count}</td>
                      <td className="py-2 px-4 text-sm text-gray-900 text-right">{Number(cls.total_due).toLocaleString()}</td>
                      <td className="py-2 px-4 text-sm text-green-700 text-right">{Number(cls.total_collected).toLocaleString()}</td>
                      <td className={`py-2 pl-4 text-sm font-medium text-right ${balance > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                        {balance.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending Students Pivot */}
      {pendingStudents.length > 0 && (
        <PendingStudents
          pendingByClass={pendingByClass}
          pendingCount={pendingStudents.length}
          pendingTotal={pendingTotal}
        />
      )}
    </div>
  )
}

function PendingStudents({ pendingByClass, pendingCount, pendingTotal }) {
  const [expandedClasses, setExpandedClasses] = useState({})

  const toggleClass = (cls) => {
    setExpandedClasses(prev => ({ ...prev, [cls]: !prev[cls] }))
  }

  return (
    <div className="card border-l-4 border-l-orange-400">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Pending Students</h3>
        <div className="flex gap-3 text-xs">
          <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-medium">
            {pendingCount} students
          </span>
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">
            {pendingTotal.toLocaleString()} due
          </span>
        </div>
      </div>

      <div className="space-y-1">
        {Object.entries(pendingByClass).map(([className, students]) => {
          const classTotal = students.reduce((sum, s) => sum + (Number(s.amount_due) - Number(s.amount_paid)), 0)
          const isExpanded = expandedClasses[className] !== false // default expanded

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
