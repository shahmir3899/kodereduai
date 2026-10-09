import { useState } from 'react'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Field from '../../../components/ui/Field'
import Input from '../../../components/ui/Input'
import Textarea from '../../../components/ui/Textarea'

// The name has to be typed back because a student was once deleted from the wrong
// row; a click-through confirm does not catch that.
export const namesMatch = (typed, name) => typed.trim().toLowerCase() === (name || '').trim().toLowerCase()

export default function DeleteStudentModal({ student, isPending, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const confirmed = namesMatch(typed, student.name)

  return (
    <Modal
      open
      onClose={onCancel}
      title="Remove student"
      size="sm"
      closeOnBackdrop={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={!confirmed} loading={isPending} onClick={() => onConfirm(reason.trim())}>
            Remove student
          </Button>
        </>
      )}
    >
      <p className="text-gray-600 dark:text-gray-300 mb-3">
        <strong>{student.name}</strong> (Roll #{student.roll_number}) will be hidden from the portal.
        Their attendance, fees, marks and enrollments are kept, and a School Admin can bring them back
        from <em>Students &rsaquo; Recently deleted</em>.
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        If the student has left the school, use Update Status (Withdrawn / Transferred) instead of removing them.
      </p>
      <div className="space-y-3">
        <Field label={`Type "${student.name}" to confirm`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Reason (optional)">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. duplicate entry" />
        </Field>
      </div>
    </Modal>
  )
}
