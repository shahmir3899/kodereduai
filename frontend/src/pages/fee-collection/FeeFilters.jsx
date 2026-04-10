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
  const isAllTypes = !feeTypeFilter
  const isMonthly = feeTypeFilter === 'MONTHLY'
  const isAnnual = feeTypeFilter === 'ANNUAL'
  const fieldWrapperClass = 'w-full sm:min-w-[150px]'
  const controlClass = 'input-field text-sm w-full'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 w-full">
      <div className={fieldWrapperClass}>
        <label className="block text-xs font-medium text-gray-500 mb-1">Fee Type</label>
        <select value={feeTypeFilter || ''} onChange={(e) => { setFeeTypeFilter(e.target.value); setAnnualCategoryFilter?.(''); setMonthlyCategoryFilter?.('') }} className={controlClass}>
          <option value="">All Types</option>
          <option value="MONTHLY">Monthly</option>
          <option value="ANNUAL">Annual</option>
        </select>
      </div>
      {isAnnual && annualCategories?.length > 0 && (
        <div className={fieldWrapperClass}>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select value={annualCategoryFilter || ''} onChange={(e) => setAnnualCategoryFilter(e.target.value)} className={controlClass}>
            <option value="">All Categories</option>
            {annualCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
      )}
      {isMonthly && monthlyCategories?.length > 0 && (
        <div className={fieldWrapperClass}>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select value={monthlyCategoryFilter || ''} onChange={(e) => setMonthlyCategoryFilter(e.target.value)} className={controlClass}>
            <option value="">All Categories</option>
            {monthlyCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
      )}
      {(isMonthly || isAllTypes) && (
        <div className={fieldWrapperClass}>
          <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className={controlClass}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
      )}
      <div className={fieldWrapperClass}>
        <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className={controlClass}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div className={fieldWrapperClass}>
        <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
        <ClassSelector
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className={controlClass}
          showAllOption
          classes={classOptions}
          scope={classOptions ? 'master' : selectorScope}
          academicYearId={classOptions ? undefined : academicYearId}
        />
      </div>
      <div className={fieldWrapperClass}>
        <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={controlClass}>
          <option value="">All</option>
          <option value="PAID">Paid</option>
          <option value="PARTIAL">Partial</option>
          <option value="UNPAID">Unpaid</option>
          <option value="ADVANCE">Advance</option>
        </select>
      </div>
    </div>
  )
}

export { MONTHS }
