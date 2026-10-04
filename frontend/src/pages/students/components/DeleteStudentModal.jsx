export default function DeleteStudentModal({ student, isPending, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Student</h2>
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete <strong>{student.name}</strong> (Roll #{student.roll_number})?
          This will also delete all their attendance records.
        </p>

        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending} className="btn btn-danger">
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
