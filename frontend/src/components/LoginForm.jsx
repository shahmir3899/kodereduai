import { useState } from 'react'
import PasswordInput from './PasswordInput'

/**
 * Sign-in card body shared by the school login (SchoolLoginPage) and the
 * portal / generic login (LoginPage), so the two can't drift apart visually.
 * Each page keeps its own post-login checks and routing; this only owns the
 * fields and their look. Meant to sit inside <AuthCardLayout>.
 */
export default function LoginForm({ onSubmit, onForgotPassword, error, loading }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({ username, password, rememberMe })
  }

  return (
    <>
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Sign In</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            type="text"
            id="username"
            className="input bg-blue-100"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
            required
            disabled={loading}
            autoFocus
          />
        </div>

        <div className="mb-4">
          <label className="label" htmlFor="password">
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            disabled={loading}
          />
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-sm text-primary-600 hover:text-primary-700 bg-transparent border-0 p-0 cursor-pointer"
            >
              Forgot password?
            </button>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <input
            id="remember_me"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="remember_me" className="text-sm text-gray-700">
            Remember me on this device
          </label>
        </div>

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full btn btn-primary py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Signing in...
            </span>
          ) : (
            'Sign In'
          )}
        </button>
      </form>
    </>
  )
}
