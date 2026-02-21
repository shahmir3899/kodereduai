import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useFeeOverview } from './useFeeOverview'
import { MONTHS } from './FeeFilters'
import FeeSummaryCards, { ClassBreakdown, PendingStudents } from './FeeSummaryCards'
import FeeCharts from './FeeCharts'

export default function FeeOverviewPage() {
  const { isStaffMember } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const canWrite = !isStaffMember
  const now = new Date()

  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [showCharts, setShowCharts] = useState(false)

  const { allPayments, summaryData, isLoading } = useFeeOverview({
    month, year,
    academicYearId: activeAcademicYear?.id,
  })

  const handlePrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  const handleNextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const handleCurrentMonth = () => {
    setMonth(now.getMonth() + 1)
    setYear(now.getFullYear())
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Fee Overview</h1>
          <p className="text-sm text-gray-600">Monthly fee status at a glance</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/finance/fees/collect?month=${month}&year=${year}`}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          >
            Collect Payments
          </Link>
          {canWrite && (
            <Link
              to="/finance/fees/setup"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
            >
              Fee Setup
            </Link>
          )}
        </div>
      </div>

      {/* Month/Year Selector */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handlePrevMonth}
          className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600"
          title="Previous month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="input-field text-sm font-medium"
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="input-field text-sm font-medium"
          >
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <button
          onClick={handleNextMonth}
          className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600"
          title="Next month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button
          onClick={handleCurrentMonth}
          className="px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50"
        >
          Current Month
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading fee data...</p>
        </div>
      )}

      {!isLoading && (
        <>
          {/* KPI Summary Cards */}
          <FeeSummaryCards summaryData={summaryData} />

          {/* Collection Progress Bar */}
          {summaryData && summaryData.total_due > 0 && (
            <div className="card mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Collection Progress</span>
                <span className="text-sm font-bold text-primary-700">
                  {Math.round((summaryData.total_collected / summaryData.total_due) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-primary-600 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (summaryData.total_collected / summaryData.total_due) * 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>{Number(summaryData.total_collected).toLocaleString()} collected</span>
                <span>{Number(summaryData.total_pending).toLocaleString()} remaining</span>
              </div>
            </div>
          )}

          {/* Class-by-class breakdown with expandable student rows */}
          <ClassBreakdown
            summaryData={summaryData}
            allPayments={allPayments}
            month={month}
            year={year}
            showCollectLink={canWrite}
          />

          {/* Pending students follow-up section */}
          <div className="mt-4">
            <PendingStudents paymentList={allPayments} />
          </div>

          {/* Charts toggle */}
          <button
            onClick={() => setShowCharts(!showCharts)}
            className="flex items-center gap-2 mt-4 mb-4 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showCharts ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showCharts ? 'Hide' : 'Show'} Charts
          </button>

          {showCharts && <FeeCharts summaryData={summaryData} />}

          {/* Empty state */}
          {!summaryData && (
            <div className="card text-center py-12">
              <p className="text-gray-500 mb-2">No fee records for {MONTHS[month - 1]} {year}</p>
              <p className="text-sm text-gray-400 mb-4">Fee records need to be generated first</p>
              {canWrite && (
                <Link
                  to="/finance/fees/setup"
                  className="inline-block px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
                >
                  Go to Fee Setup
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
