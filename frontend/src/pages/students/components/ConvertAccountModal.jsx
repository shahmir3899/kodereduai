import { useState } from 'react'
import Modal from '../../../components/ui/Modal'
import Field from '../../../components/ui/Field'
import { useQueryClient } from '@tanstack/react-query'
import { PasswordInput } from '../../../components'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { usePasswordPolicy } from '../../../hooks/usePasswordPolicy'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

const suggestUsername = (name) => name?.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || ''

// Creates a portal login for one existing student. Mount it only while open
// (key by student) so the form starts from that student's suggested values.
export default function ConvertAccountModal({ student, onClose }) {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { validate: validatePassword } = usePasswordPolicy()
  const [form, setForm] = useState({
    username: suggestUsername(student.name),
    email: student.guardian_email || '',
    password: '',
    confirm_password: '',
  })
  const [error, setError] = useState('')
  const [isConverting, setIsConverting] = useState(false)

  useEscapeKey(onClose, true)

  const handleConvert = async () => {
    setError('')
    if (!form.username || !form.password) {
      setError('Username and password are required.')
      return
    }
    const pwdError = validatePassword(form.password, form.confirm_password)
    if (pwdError) {
      setError(pwdError)
      return
    }
    setIsConverting(true)
    try {
      await studentsApi.createStudentUserAccount(student.id, form)
      queryClient.invalidateQueries({ queryKey: ['students'] })
      showSuccess('User account created successfully!')
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.detail || 'Failed to create user account')
      setIsConverting(false)
    }
  }

  return (
    <Modal open  closeOnBackdrop={false}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Create User Account</h2>
        <p className="text-sm text-gray-500 mb-4">
          For student: <strong>{student.name}</strong> (Roll #{student.roll_number})
        </p>

        <div className="space-y-3">
          <Field label="Username" required>
<input
              type="text"
              className="input"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="Login username"
            />
</Field>
          <Field label="Email">
<input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="Email (optional)"
            />
</Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Password *</label>
              <PasswordInput
                className="input"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min 8 chars"
              />
            </div>
            <div>
              <label className="label">Confirm *</label>
              <PasswordInput
                className="input"
                value={form.confirm_password}
                onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
                placeholder="Confirm"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="btn btn-secondary" disabled={isConverting}>
            Cancel
          </button>
          <button onClick={handleConvert} className="btn btn-primary" disabled={isConverting}>
            {isConverting ? 'Creating...' : 'Create Account'}
          </button>
        </div>
      </Modal>
  )
}
