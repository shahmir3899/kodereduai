import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { requestPasswordReset } from '../services/auth'
import { AuthCardLayout } from '../components'

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
      <AuthCardLayout subtitle="Reset your password">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4">Check your email</h2>
        <p className="text-gray-600">If an account exists for this email, a password reset link has been sent.</p>
        <Link to="/login" className="mt-6 inline-block text-sm text-primary-600 hover:text-primary-700">
          Back to sign in
        </Link>
      </AuthCardLayout>
    )
  }

  return (
    <AuthCardLayout subtitle="Reset your password">
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Forgot Password</h2>
      <p className="text-sm text-gray-600 mb-4">
        Enter the email on your account and we'll send you a link to reset your password.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email Address</label>
          <input
            type="email"
            id="email"
            className="input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button type="submit" className="w-full btn btn-primary py-3">Send Reset Link</button>
      </form>
      <Link to="/login" className="mt-4 inline-block text-sm text-primary-600 hover:text-primary-700">
        Back to sign in
      </Link>
    </AuthCardLayout>
  )
}
