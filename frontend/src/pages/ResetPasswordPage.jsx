import React, { useState, useEffect } from 'react'
import { PasswordInput, AuthCardLayout } from '../components'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { validatePasswordResetToken, confirmPasswordReset } from '../services/auth'
import { usePasswordPolicy } from '../hooks/usePasswordPolicy'

// Titled "Choose a New Password" rather than "Reset Password" — the admin-initiated
// flows (Staff Directory, Super Admin) already use "Reset Password" as the label for
// setting/emailing someone else's password, and reusing it here for this self-service,
// emailed-link flow made the two easy to confuse when referenced by name.
export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { validate } = usePasswordPolicy()
  const uid = params.get('uid') || ''
  const token = params.get('token') || ''
  const [valid, setValid] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (uid && token) {
      validatePasswordResetToken(uid, token)
        .then(() => setValid(true))
        .catch(() => setValid(false))
    } else {
      setValid(false)
    }
  }, [uid, token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const pwdError = validate(newPassword, confirmPassword)
    if (pwdError) {
      setError(pwdError)
      return
    }
    setSubmitting(true)
    try {
      await confirmPasswordReset(uid, token, newPassword, confirmPassword)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(err?.response?.data?.confirm_password || err?.response?.data?.token || 'Failed to reset password.')
    }
    setSubmitting(false)
  }

  if (valid === false) {
    return (
      <AuthCardLayout subtitle="Reset your password">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4">Link expired</h2>
        <p className="text-red-600">This reset link is invalid or expired.</p>
        <Link to="/forgot-password" className="mt-6 inline-block text-sm text-primary-600 hover:text-primary-700">
          Request a new link
        </Link>
      </AuthCardLayout>
    )
  }
  if (success) {
    return (
      <AuthCardLayout subtitle="Reset your password">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4">Password updated</h2>
        <p className="text-gray-600">Your password has been reset. Redirecting to sign in...</p>
      </AuthCardLayout>
    )
  }
  if (valid === null) {
    return null
  }
  return (
    <AuthCardLayout subtitle="Reset your password">
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Choose a New Password</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="new_password">New Password</label>
          <PasswordInput
            id="new_password"
            className="input w-full"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Min 8 characters"
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm_password">Confirm Password</label>
          <PasswordInput
            id="confirm_password"
            className="input w-full"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button type="submit" className="w-full btn btn-primary py-3" disabled={submitting}>
          {submitting ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
    </AuthCardLayout>
  )
}
