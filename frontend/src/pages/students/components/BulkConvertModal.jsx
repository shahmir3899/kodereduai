import { useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useQueryClient } from '@tanstack/react-query'
import { PasswordInput } from '../../../components'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { usePasswordPolicy } from '../../../hooks/usePasswordPolicy'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

// Creates portal logins for the ticked students with one shared default password.
// Mount only while open. onConverted fires on success so the page can clear its
// selection; the results screen stays until Done.
export default function BulkConvertModal({ studentIds, onConverted, onClose }) {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { validateLength: validatePasswordLength } = usePasswordPolicy()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)
  const [isConverting, setIsConverting] = useState(false)
  // The page clears its selection on success, which would zero the count in the
  // button label while the request is still settling.
  const [count] = useState(studentIds.length)

  useEscapeKey(onClose, true)

  const handleConvert = async () => {
    setError('')
    const pwdError = password ? validatePasswordLength(password) : 'Default password is required.'
    if (pwdError) {
      setError(pwdError)
      return
    }
    setIsConverting(true)
    try {
      const response = await studentsApi.bulkCreateAccounts({
        student_ids: studentIds,
        default_password: password,
      })
      setResults(response.data)
      queryClient.invalidateQueries({ queryKey: ['students'] })
      onConverted()
      showSuccess(`Created ${response.data.created_count} user account(s)!`)
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.detail || 'Bulk conversion failed')
    } finally {
      setIsConverting(false)
    }
  }

  return (
    <Modal open  closeOnBackdrop={false}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Bulk Create User Accounts</h2>

        {!results ? (
          <>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
              <p className="text-purple-800 text-sm">
                Create user accounts for <strong>{count}</strong> selected student(s).
                Usernames will be auto-generated from student names.
              </p>
            </div>

            <div>
              <label className="label">Default Password *</label>
              <PasswordInput
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters — same for all accounts"
              />
              <p className="text-xs text-gray-500 mt-1">Students can change their password after first login.</p>
            </div>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={onClose} className="btn btn-secondary" disabled={isConverting}>
                Cancel
              </button>
              <button onClick={handleConvert} className="btn btn-primary" disabled={isConverting}>
                {isConverting ? 'Creating...' : `Create ${count} Account(s)`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-green-800 text-sm font-medium">Created: {results.created_count} account(s)</p>
              </div>
              {results.skipped_count > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-yellow-800 text-sm font-medium">Skipped: {results.skipped_count} (already have accounts)</p>
                </div>
              )}
              {results.error_count > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-800 text-sm font-medium">Errors: {results.error_count}</p>
                  <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
                    {results.errors?.map((e, i) => (
                      <li key={i}>{e.name}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {results.created?.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-gray-600 mb-1">Created usernames:</p>
                  <div className="space-y-1">
                    {results.created.map((c, i) => (
                      <div key={i} className="flex justify-between text-xs bg-gray-50 px-2 py-1 rounded">
                        <span className="text-gray-700">{c.student_name}</span>
                        <span className="font-mono text-gray-900">{c.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="btn btn-primary">
                Done
              </button>
            </div>
          </>
        )}
      </Modal>
  )
}
