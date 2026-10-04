export default function BulkUploadModal({ bulkData, classes, isUploading, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Confirm Bulk Upload</h2>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-blue-800">
            Ready to upload <strong>{bulkData.totalStudents}</strong> students
            across <strong>{bulkData.classCount}</strong> classes.
          </p>
        </div>

        <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
          {Object.entries(bulkData.studentsByClass || {}).map(([classId, students]) => {
            const cls = classes.find((c) => c.id === parseInt(classId))
            return (
              <div key={classId} className="flex justify-between text-sm">
                <span className="text-gray-600">{cls?.name || `Class ${classId}`}</span>
                <span className="font-medium">{students.length} students</span>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} disabled={isUploading} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isUploading} className="btn btn-primary">
            {isUploading ? 'Uploading...' : 'Upload Students'}
          </button>
        </div>
      </div>
    </div>
  )
}
