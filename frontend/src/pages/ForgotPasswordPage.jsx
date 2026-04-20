import React, { useState } from 'react'
import { requestPasswordReset } from '../services/auth'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await requestPasswordReset(email)
      setSubmitted(true)
    } catch (err) {
      setError('Something went wrong. Please try again later.')
    }
  }

  if (submitted) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 card">
        <h2 className="text-xl font-bold mb-4">Forgot Password</h2>
        <p>If an account exists for this email, a password reset link has been sent.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto mt-16 p-6 card">
      <h2 className="text-xl font-bold mb-4">Forgot Password</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1 font-medium">Email Address</label>
          <input
            type="email"
            className="input w-full"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button type="submit" className="btn btn-primary w-full">Send Reset Link</button>
      </form>
    </div>
  )
}
