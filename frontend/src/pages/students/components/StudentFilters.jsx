// Filter card: school picker (super admin), search, inactive toggle, class chips, gender summary.
export default function StudentFilters({
  isSuperAdmin,
  schools,
  selectedSchoolId,
  onSchoolChange,
  search,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  classChipData,
  selectedClassIds,
  onClearClasses,
  onToggleClass,
  shownCount,
  genderSummary,
  isLoading,
}) {
  return (
    <div className="card mb-6">
      <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${isSuperAdmin ? 'sm:grid-cols-2' : ''}`}>
        {isSuperAdmin && (
          <div>
            <label className="label">School</label>
            <select
              className="input"
              value={selectedSchoolId || ''}
              onChange={(e) => onSchoolChange(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">-- Select School --</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={isSuperAdmin ? '' : 'w-full'}>
          <label className="label">Search</label>
          <input
            type="text"
            className="input"
            placeholder="Search by name or roll number..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={!selectedSchoolId}
          />
        </div>
      </div>

      {selectedSchoolId && (
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-600 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onShowInactiveChange(e.target.checked)}
            className="rounded"
          />
          Show inactive records
        </label>
      )}

      {/* Class chips: always the full list; 0-count chips are dimmed */}
      {selectedSchoolId && classChipData.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            type="button"
            onClick={onClearClasses}
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedClassIds.length === 0
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {classChipData.map((item) => {
            const isActive = selectedClassIds.includes(item.id)
            const isEmpty = item.count === 0
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggleClass(item.id)}
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : isEmpty
                    ? 'bg-gray-50 text-gray-300 border border-gray-100'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {item.name}
                <span className={isActive ? 'text-primary-200' : isEmpty ? 'text-gray-300' : 'text-gray-400'}>
                  ({item.count})
                </span>
              </button>
            )
          })}
        </div>
      )}

      {selectedSchoolId && !isLoading && shownCount > 0 && (
        <div className="border-t border-gray-100 mt-3 pt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <span><strong className="text-gray-900">{shownCount}</strong> shown</span>
          <span>Male: <strong>{genderSummary.male}</strong></span>
          <span>Female: <strong>{genderSummary.female}</strong></span>
          {genderSummary.other > 0 && <span>Other: <strong>{genderSummary.other}</strong></span>}
          {genderSummary.unknown > 0 && <span>Unknown: <strong>{genderSummary.unknown}</strong></span>}
        </div>
      )}
    </div>
  )
}
