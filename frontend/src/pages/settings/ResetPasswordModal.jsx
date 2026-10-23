import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import { PasswordInput } from '../../components'
import { useToast } from '../../components/Toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { usePasswordPolicy } from '../../hooks/usePasswordPolicy'
import { usersApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'

// Admin-side reset for another user's password: set one now, or email the user a reset link.
// The API enforces who may reset whom; the Settings page only offers this on rows the
// admin could also edit.
export default function ResetPasswordModal({ user, onClose }) {
  const { showSuccess } = useToast()
  const { validate: validatePassword } = usePasswordPolicy()
  const [mode, setMode] = useState('set')
  const [form, setForm] = useState({ new_password: '', confirm_password: '' })
  const [error, setError] = useState('')

  const hasEmail = !!user.email
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username

  useEscapeKey(onClose, true)

  const resetMutation = useMutation({
    mutationFn: (data) => usersApi.resetPassword(user.id, data),
    onSuccess: (response) => {
      showSuccess(response?.data?.message || (mode === 'email' ? 'Reset email sent' : 'Password reset'))
      onClose()
    },
    onError: (err) => setError(getErrorMessage(err, 'Failed to reset password')),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'email') {
      resetMutation.mutate({ mode: 'email' })
      return
    }
    if (!form.new_password) {
      setError('Enter a new password.')
      return
    }
    const problem = validatePassword(form.new_password, form.confirm_password)
    if (problem) {
      setError(problem)
      return
    }
    resetMutation.mutate({ mode: 'set', ...form })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Reset Password</h3>
            <p className="text-sm text-gray-500">{name} (@{user.username})</p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" name="reset-mode" checked={mode === 'set'} onChange={() => setMode('set')} />
              Set a new password now
            </label>
            <label className={`flex items-center gap-2 text-sm ${hasEmail ? 'text-gray-700' : 'text-gray-400'}`}>
              <input
                type="radio"
                name="reset-mode"
                checked={mode === 'email'}
                disabled={!hasEmail}
                onChange={() => setMode('email')}
              />
              Email a reset link{hasEmail ? ` to ${user.email}` : ' (no email on file)'}
            </label>
          </div>

          {mode === 'set' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="New Password" required>
                <PasswordInput
                  value={form.new_password}
                  onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
                  className="input-field"
                  placeholder="Min 8 characters"
                />
              </Field>
              <Field label="Confirm Password" required>
                <PasswordInput
                  value={form.confirm_password}
                  onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
                  className="input-field"
                  placeholder="Confirm"
                />
              </Field>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={resetMutation.isPending} className="flex-1">
              {resetMutation.isPending ? 'Saving...' : mode === 'email' ? 'Send Email' : 'Reset Password'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
