import Modal from '../../../components/ui/Modal'
export default function BulkUploadModal({ bulkData, classes, sessionClasses = [], isUploading, onCancel, onConfirm }) {
  return (
    <Modal open  closeOnBackdrop={false}>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Confirm Bulk Upload</h2>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-blue-800">
            Ready to upload <strong>{bulkData.totalStudents}</strong> students
            across <strong>{bulkData.classCount}</strong> classes.
          </p>
        </div>

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
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isUploading} className="btn btn-primary">
            {isUploading ? 'Uploading...' : 'Upload Students'}
          </button>
        </div>
      </Modal>
  )
}
