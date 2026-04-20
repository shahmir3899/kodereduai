import React, { useState, useEffect } from 'react'
import { PasswordInput } from '../components'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { validatePasswordResetToken, confirmPasswordReset } from '../services/auth'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
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
      <div className="max-w-md mx-auto mt-16 p-6 card">
        <h2 className="text-xl font-bold mb-4">Reset Password</h2>
        <p className="text-red-600">This reset link is invalid or expired.</p>
      </div>
    )
  }
  if (success) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 card">
        <h2 className="text-xl font-bold mb-4">Password Reset Successful</h2>
        <p>Your password has been reset. Redirecting to login...</p>
      </div>
    )
  }
  if (valid === null) {
    return null
  }
  return (
    <div className="max-w-md mx-auto mt-16 p-6 card">
      <h2 className="text-xl font-bold mb-4">Reset Password</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1 font-medium">New Password</label>
          <PasswordInput
            className="input w-full"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="block mb-1 font-medium">Confirm Password</label>
          <PasswordInput
            className="input w-full"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
          {submitting ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
    </div>
  )
}
