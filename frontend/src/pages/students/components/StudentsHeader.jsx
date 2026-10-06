import { useEffect, useRef, useState } from 'react'
import PageHeader from '../../../components/ui/PageHeader'

// Page title row: export menu, Excel template/upload, Add Student.
export default function StudentsHeader({
  showTools,
  hasStudents,
  hasAcademicYear,
  fileInputRef,
  onExportPDF,
  onExportPNG,
  onDownloadExcel,
  onUploadFile,
  onAdd,
}) {
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportRef = useRef(null)

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setShowExportMenu(false)
      }
    }
    if (showExportMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showExportMenu])

  return (
    <PageHeader title="Students" subtitle="Manage students in your school" className="mb-6" actions={<>
{showTools && (
          <>
            {hasStudents && (
              <div className="relative" ref={exportRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="btn btn-secondary flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                    <button
                      onClick={() => { setShowExportMenu(false); onExportPDF() }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                      Download PDF
                    </button>
                    <button
                      onClick={() => { setShowExportMenu(false); onExportPNG() }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                      </svg>
                      Download PNG
                    </button>
                  </div>
                )}
              </div>
            )}
            <button onClick={onDownloadExcel} className="btn btn-secondary">
              Download Excel
            </button>
            <label className={`btn btn-secondary cursor-pointer ${!hasAcademicYear ? 'opacity-50 pointer-events-none' : ''}`}>
              Upload Excel
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onUploadFile}
                className="hidden"
                disabled={!hasAcademicYear}
              />
            </label>
          </>
        )}
        <button onClick={onAdd} className="btn btn-primary" disabled={!hasAcademicYear}>
          Add Student
        </button>
</>} />
  )
}
