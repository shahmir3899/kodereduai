import ReportPeriodPicker from '../../../components/ReportPeriodPicker'

// Floating bar shown while students are ticked in the list.
export default function SelectionBar({
  count,
  isGeneratingReports,
  reportProgress,
  activeAcademicYearId,
  onCreateAccounts,
  onDownloadReports,
  onClear,
}) {
  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 z-40 bg-purple-600 text-white px-4 sm:px-6 py-3 rounded-2xl sm:rounded-full shadow-lg flex flex-wrap items-center justify-center gap-2 sm:gap-4">
      <span className="text-sm font-medium">
        {isGeneratingReports
          ? `Downloading ${reportProgress.current} of ${reportProgress.total}...`
          : `${count} student(s) selected`}
      </span>
      <button
        onClick={onCreateAccounts}
        className="bg-white text-purple-700 px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-purple-50"
      >
        Create Accounts
      </button>
      <ReportPeriodPicker
        label={isGeneratingReports ? 'Downloading...' : 'Download Reports'}
        activeAcademicYearId={activeAcademicYearId}
        disabled={isGeneratingReports}
        onSelect={onDownloadReports}
        buttonClassName="bg-white text-purple-700 px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-purple-50 disabled:opacity-50 flex items-center gap-1"
        openUpward
      />
      <button
        onClick={onClear}
        disabled={isGeneratingReports}
        className="text-purple-200 hover:text-white text-sm disabled:opacity-50"
      >
        Clear
      </button>
    </div>
  )
}
