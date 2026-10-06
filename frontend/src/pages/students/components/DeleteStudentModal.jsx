import Modal from '../../../components/ui/Modal'
export default function DeleteStudentModal({ student, isPending, onCancel, onConfirm }) {
  return (
    <Modal open  size="sm" closeOnBackdrop={false}>
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
      </Modal>
  )
}
