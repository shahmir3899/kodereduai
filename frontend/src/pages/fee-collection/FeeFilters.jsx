import ClassSelector from '../../components/ClassSelector'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export default function FeeFilters({
  month,
  setMonth,
  year,
  setYear,
  classFilter,
  setClassFilter,
  statusFilter,
  setStatusFilter,
  feeTypeFilter,
  setFeeTypeFilter,
  annualCategoryFilter,
  setAnnualCategoryFilter,
  monthlyCategoryFilter,
  setMonthlyCategoryFilter,
  annualCategories,
  monthlyCategories,
  classOptions,
  selectorScope,
  academicYearId,
}) {
  const isMonthly = !feeTypeFilter || feeTypeFilter === 'MONTHLY'
  const isAnnual = feeTypeFilter === 'ANNUAL'

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Fee Type</label>
        <select value={feeTypeFilter || ''} onChange={(e) => { setFeeTypeFilter(e.target.value); setAnnualCategoryFilter?.(''); setMonthlyCategoryFilter?.('') }} className="input-field text-sm">
          <option value="">All Types</option>
          <option value="MONTHLY">Monthly</option>
          <option value="ANNUAL">Annual</option>
        </select>
      </div>
      {isAnnual && annualCategories?.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select value={annualCategoryFilter || ''} onChange={(e) => setAnnualCategoryFilter(e.target.value)} className="input-field text-sm">
            <option value="">All Categories</option>
            {annualCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
      )}
      {isMonthly && monthlyCategories?.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select value={monthlyCategoryFilter || ''} onChange={(e) => setMonthlyCategoryFilter(e.target.value)} className="input-field text-sm">
            <option value="">All Categories</option>
            {monthlyCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
      )}
      {isMonthly && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="input-field text-sm">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="input-field text-sm">
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
        <ClassSelector
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="input-field text-sm"
          showAllOption
          classes={classOptions}
          scope={classOptions ? 'master' : selectorScope}
          academicYearId={classOptions ? undefined : academicYearId}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field text-sm">
          <option value="">All</option>
          <option value="PAID">Paid</option>
          <option value="PARTIAL">Partial</option>
          <option value="UNPAID">Unpaid</option>
          <option value="ADVANCE">Advance</option>
        </select>
      </div>
    </>
  )
}

export { MONTHS }
