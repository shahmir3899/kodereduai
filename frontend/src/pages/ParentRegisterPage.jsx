import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { PasswordInput } from '../components'
import { useToast } from '../components/Toast'
import { parentsApi } from '../services/api'
import { getErrorMessage } from '../utils/errorUtils'

const EMPTY_FORM = {
  invite_code: '',
  username: '',
  email: '',
  password: '',
  confirm_password: '',
  first_name: '',
  last_name: '',
  phone: '',
  relation: '',
}

export default function ParentRegisterPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { showSuccess } = useToast()
  const [form, setForm] = useState({ ...EMPTY_FORM, invite_code: searchParams.get('code') || '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (form.password !== form.confirm_password) {
      setError("Passwords don't match.")
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      // Unlike other registration flows in this app, ParentRegistrationSerializer
      // requires and re-validates confirm_password server-side — don't strip it.
      const payload = { ...form }
      // Backend defaults relation to the invite's own relation when omitted.
      if (!payload.relation) delete payload.relation
      if (!payload.email) delete payload.email
      await parentsApi.register(payload)
      showSuccess('Account created — please sign in.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, 'Registration failed. Please check your invite code and try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6 sm:mb-8">
          <img src="/Logo.jpeg" alt="EducationAI" className="h-16 w-16 rounded-full object-cover mx-auto mb-3" />
          <h1 className="text-2xl sm:text-3xl font-bold text-primary-700">Parent Registration</h1>
          <p className="mt-2 text-gray-600">Create your account using the invite code from your school</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-5 sm:p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="invite_code">Invite Code</label>
              <input
                type="text"
                id="invite_code"
                className="input"
                value={form.invite_code}
                onChange={set('invite_code')}
                placeholder="Code from your school"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="relation">Relation to Student (optional)</label>
              <select id="relation" className="input" value={form.relation} onChange={set('relation')}>
                <option value="">Use invite default</option>
                <option value="FATHER">Father</option>
                <option value="MOTHER">Mother</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="first_name">First Name</label>
                <input type="text" id="first_name" className="input" value={form.first_name} onChange={set('first_name')} />
              </div>
              <div>
                <label className="label" htmlFor="last_name">Last Name</label>
                <input type="text" id="last_name" className="input" value={form.last_name} onChange={set('last_name')} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="phone">Phone *</label>
              <input
                type="text"
                id="phone"
                className="input"
                value={form.phone}
                onChange={set('phone')}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="email">Email (optional)</label>
              <input type="email" id="email" className="input" value={form.email} onChange={set('email')} />
            </div>

            <div>
              <label className="label" htmlFor="username">Username *</label>
              <input
                type="text"
                id="username"
                className="input"
                value={form.username}
                onChange={set('username')}
                required
                autoComplete="username"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="password">Password *</label>
                <PasswordInput
                  id="password"
                  className="input"
                  value={form.password}
                  onChange={set('password')}
                  placeholder="Min 8 characters"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="confirm_password">Confirm *</label>
                <PasswordInput
                  id="confirm_password"
                  className="input"
                  value={form.confirm_password}
                  onChange={set('confirm_password')}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Already have an account? <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
