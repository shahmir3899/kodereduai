import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useFeeOverview } from './useFeeOverview'
import { MONTHS } from './FeeFilters'
import FeeSummaryCards, { ClassBreakdown, PendingStudents } from './FeeSummaryCards'
import FeeCharts from './FeeCharts'

export default function FeeOverviewPage() {
  const { isStaffMember } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const [searchParams, setSearchParams] = useSearchParams()
  const canWrite = !isStaffMember
  const now = new Date()
  const initialFeeType = (searchParams.get('feeType') || 'MONTHLY').toUpperCase() === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY'
  const initialAnnualCategory = searchParams.get('annualCategory') || ''
  const initialMonthlyCategory = searchParams.get('monthlyCategory') || ''

  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [feeType, setFeeType] = useState(initialFeeType)
  const [annualCategoryFilter, setAnnualCategoryFilter] = useState(initialAnnualCategory)
  const [monthlyCategoryFilter, setMonthlyCategoryFilter] = useState(initialMonthlyCategory)
  const [showCharts, setShowCharts] = useState(false)

  const { allPayments, summaryData, annualCategories, monthlyCategories, isLoading } = useFeeOverview({
    month, year,
    feeType,
    annualCategoryId: feeType === 'ANNUAL' ? annualCategoryFilter : undefined,
    monthlyCategoryId: feeType === 'MONTHLY' ? monthlyCategoryFilter : undefined,
    academicYearId: activeAcademicYear?.id,
  })

  const handleFeeTypeChange = (nextType) => {
    setFeeType(nextType)
    if (nextType === 'ANNUAL') setMonthlyCategoryFilter('')
    if (nextType === 'MONTHLY') setAnnualCategoryFilter('')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('feeType', nextType)
      if (nextType === 'ANNUAL') next.delete('monthlyCategory')
      if (nextType === 'MONTHLY') next.delete('annualCategory')
      return next
    }, { replace: true })
  }

  const handleCategoryChange = (value) => {
    if (feeType === 'ANNUAL') {
      setAnnualCategoryFilter(value)
    } else {
      setMonthlyCategoryFilter(value)
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (feeType === 'ANNUAL') {
        if (value) next.set('annualCategory', value)
        else next.delete('annualCategory')
      } else {
        if (value) next.set('monthlyCategory', value)
        else next.delete('monthlyCategory')
      }
      return next
    }, { replace: true })
  }

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
          <p className="text-sm text-gray-600">
            {feeType === 'ANNUAL' ? 'Annual fee status at a glance' : 'Monthly fee status at a glance'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => handleFeeTypeChange('MONTHLY')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                feeType === 'MONTHLY'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => handleFeeTypeChange('ANNUAL')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                feeType === 'ANNUAL'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Annual
            </button>
          </div>
          <Link
            to={`/finance/fees/collect?month=${month}&year=${year}&fee_type=${feeType}`}
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
      {feeType === 'MONTHLY' ? (
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
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="input-field text-sm font-medium"
            >
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600">Category</label>
            <select
              value={annualCategoryFilter}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="input-field text-sm font-medium min-w-[220px]"
            >
              <option value="">All categories</option>
              {annualCategories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {feeType === 'MONTHLY' && (
        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm font-medium text-gray-600">Category</label>
          <select
            value={monthlyCategoryFilter}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="input-field text-sm font-medium min-w-[220px]"
          >
            <option value="">All categories</option>
            {monthlyCategories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      )}

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

          {summaryData?.by_category?.length > 0 && (
            <div className="card mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Category-wise Collection</h3>
                <span className="text-xs text-gray-500">{summaryData.by_category.length} categories</span>
              </div>
              <div className="space-y-2">
                {summaryData.by_category.map((category) => {
                  const totalDue = Number(category.total_due || 0)
                  const totalCollected = Number(category.total_collected || 0)
                  const rate = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0

                  return (
                    <div key={category.category_id || category.category_name} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="font-medium text-gray-900">{category.category_name || 'Uncategorized'}</span>
                        <span className="text-gray-600">{totalCollected.toLocaleString()} / {totalDue.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary-600 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, rate)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-gray-500 flex justify-between">
                        <span>{category.count} records</span>
                        <span>{rate}% collected</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
            <div className="card p-4 sm:p-6">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Step 1 */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-green-100 text-green-700">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-green-500 text-white">{'\u2713'}</span>
                  Select Month/Year
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                {/* Step 2 */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">2</span>
                  Generate Fee Records
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                {/* Step 3 */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
                  View Summary &amp; Collect
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-3">
                No fee records for <strong>{feeType === 'ANNUAL' ? year : `${MONTHS[month - 1]} ${year}`}</strong>. Fee records need to be generated first.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Tip:</span> Fee records must be generated in Fee Setup before they appear here.
                </p>
              </div>
              {canWrite && (
                <Link
                  to="/finance/fees/setup"
                  className="inline-block mt-3 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
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
