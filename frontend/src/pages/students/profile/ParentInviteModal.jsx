import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { parentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { getApiErrorMessage } from './profileUtils'

// One-time invite code linking a parent/guardian portal account to the student.
// Mount only while open.
export default function ParentInviteModal({ student, onClose }) {
  const { showError } = useToast()
  const [form, setForm] = useState({ relation: 'FATHER', parent_phone: '' })
  const [invite, setInvite] = useState(null)
  const [copied, setCopied] = useState(false)

  useEscapeKey(onClose, true)

  const mutation = useMutation({
    mutationFn: (payload) => parentsApi.generateInvite({ student_id: student.id, ...payload }),
    onSuccess: (res) => {
      setInvite(res.data)
      setCopied(false)
    },
    onError: (error) => showError(getApiErrorMessage(error, 'Failed to generate parent invite')),
  })

  const link = invite ? `${window.location.origin}/parent/register?code=${invite.invite_code}` : ''

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Generate Parent Invite</h2>
          <p className="text-sm text-gray-500 mt-1">
            {invite
              ? 'Share this code or link with the parent/guardian so they can create their own portal account.'
              : `Create a one-time invite code linking a parent/guardian account to ${student.name}.`}
          </p>
        </div>

        {invite ? (
          <div className="p-6 space-y-4">
            <div>
              <label htmlFor="invite-code" className="block text-sm font-medium text-gray-700 mb-1">Invite Code</label>
              <input
                id="invite-code"
                type="text"
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
                value={invite.invite_code}
              />
            </div>
            <div>
              <label htmlFor="invite-link" className="block text-sm font-medium text-gray-700 mb-1">Registration Link</label>
              <div className="flex items-center gap-2">
                <input
                  id="invite-link"
                  type="text"
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                  value={link}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(link)
                    setCopied(true)
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400">Expires in 30 days, or once used.</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <label htmlFor="invite-relation" className="block text-sm font-medium text-gray-700 mb-1">Relation to Student</label>
              <select
                id="invite-relation"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.relation}
                onChange={(e) => setForm((p) => ({ ...p, relation: e.target.value }))}
              >
                <option value="FATHER">Father</option>
                <option value="MOTHER">Mother</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="invite-phone" className="block text-sm font-medium text-gray-700 mb-1">Parent Phone (optional)</label>
              <input
                id="invite-phone"
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.parent_phone}
                onChange={(e) => setForm((p) => ({ ...p, parent_phone: e.target.value }))}
                placeholder="For verification during registration"
              />
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            {invite ? 'Done' : 'Cancel'}
          </button>
          {!invite && (
            <button
              type="button"
              onClick={() => mutation.mutate(form)}
              disabled={mutation.isPending}
              className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Generating...' : 'Generate Invite'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
