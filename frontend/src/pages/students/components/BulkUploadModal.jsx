import Modal from '../../../components/ui/Modal'
import { BULK_BATCH_SIZE, batchCount } from '../bulkImport'

const SHOWN = 8

export default function BulkUploadModal({
  bulkData, classes, sessionClasses = [], isUploading, progress, result, onCancel, onConfirm,
}) {
  const batches = batchCount(bulkData.studentsByClass || {})
  const issues = bulkData.issues || []
  const retrying = !!result

  return (
    <Modal open  closeOnBackdrop={false}>
        <h2 className="text-xl font-bold text-gray-900 mb-4">{retrying ? 'Some students failed' : 'Confirm Bulk Upload'}</h2>

        {retrying && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-amber-800 text-sm font-medium">{result.summary}. The rest are listed below.</p>
            <ul className="mt-2 text-xs text-amber-800 list-disc pl-4 space-y-0.5">
              {result.failures.slice(0, SHOWN).map((f, i) => <li key={i}>{f}</li>)}
              {result.failures.length > SHOWN && <li>…and {result.failures.length - SHOWN} more</li>}
            </ul>
            <p className="mt-2 text-xs text-amber-800">
              Saved students are not sent again. Fix the cause and press Retry, or Close and correct the file.
            </p>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-blue-800">
            {retrying ? 'To retry: ' : 'Ready to upload '}<strong>{bulkData.totalStudents}</strong> students
            across <strong>{bulkData.classCount}</strong> classes.
          </p>
          {batches > 1 && (
            <p className="text-blue-700 text-xs mt-1">
              Sent in {batches} batches of up to {BULK_BATCH_SIZE}. This can take a moment, so keep this tab open until it finishes.
            </p>
          )}
          {isUploading && progress && (
            <p className="text-blue-800 text-xs mt-1 font-medium">Uploading… {progress.done} of {progress.total}</p>
          )}
        </div>

        {issues.length > 0 && !retrying && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-amber-800 text-xs font-medium">{issues.length} row(s) in the file will be skipped:</p>
            <ul className="mt-1 text-xs text-amber-800 list-disc pl-4">
              {issues.slice(0, SHOWN).map((m, i) => <li key={i}>{m}</li>)}
              {issues.length > SHOWN && <li>…and {issues.length - SHOWN} more</li>}
            </ul>
          </div>
        )}

        <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
          {Object.entries(bulkData.studentsByClass || {}).map(([key, students]) => {
            // Key is "classId" or "classId:sessionClassId" (see parseStudentRows).
            const [classId, sessionClassId] = key.split(':')
            const section = sessionClassId && sessionClasses.find((sc) => sc.id === parseInt(sessionClassId))
            const cls = classes.find((c) => c.id === parseInt(classId))
            return (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-gray-600">{section ? (section.label || section.display_name) : (cls?.name || `Class ${classId}`)}</span>
                <span className="font-medium">{students.length} students</span>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} disabled={isUploading} className="btn btn-secondary">
            {retrying ? 'Close' : 'Cancel'}
          </button>
          <button onClick={onConfirm} disabled={isUploading} className="btn btn-primary">
            {isUploading ? 'Uploading...' : retrying ? 'Retry failed' : 'Upload Students'}
          </button>
        </div>
      </Modal>
  )
}
