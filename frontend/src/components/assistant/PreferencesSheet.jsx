import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assistantApi } from '../../services/assistantApi'

const LANGUAGE_LABELS = { auto: 'Same as I write', en: 'English', ur: 'Urdu (اردو)', roman: 'Roman Urdu' }

/** What Aura remembers about me: reply language, usual class, usual fee account. An empty class or account means "forget it". */
export default function PreferencesSheet({ onClose }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['assistant-preferences'], queryFn: () => assistantApi.getPreferences().then((r) => r.data) })
  const [language, setLanguage] = useState('auto')
  const [defaultClass, setDefaultClass] = useState('')
  const [account, setAccount] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const p = query.data?.preferences
    if (!p) return
    setLanguage(p.language || 'auto')
    setDefaultClass(p.default_class || '')
    setAccount(p.default_account_id ? String(p.default_account_id) : '')
  }, [query.data])

  const save = useMutation({
    mutationFn: () => assistantApi.updatePreferences({
      language,
      default_class: defaultClass.trim(),
      ...(query.data?.accounts?.length ? { default_account_id: account ? Number(account) : '' } : {}),
    }),
    onSuccess: () => { setError(''); setSaved(true); queryClient.invalidateQueries({ queryKey: ['assistant-preferences'] }) },
    onError: (e) => { setSaved(false); setError(e?.response?.data?.error || 'Could not save. Please try again.') },
  })

  const accounts = query.data?.accounts || []
  return (
    <div className="flex flex-1 flex-col overflow-y-auto" data-testid="preferences-sheet">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-medium text-slate-900">What Aura remembers</p>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Back</button>
      </div>
      {query.isLoading && <p className="p-3 text-xs text-slate-500">Loading…</p>}
      {query.isError && <p role="alert" className="p-3 text-xs text-red-700">Could not load your preferences.</p>}
      {query.data && (
        <form className="space-y-3 p-3" onSubmit={(e) => { e.preventDefault(); setSaved(false); save.mutate() }}>
          <label className="block text-xs text-slate-700">
            Reply language
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              {Object.keys(query.data.languages || LANGUAGE_LABELS).map((k) => <option key={k} value={k}>{LANGUAGE_LABELS[k] || k}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-700">
            My usual class (for example 5A)
            <input value={defaultClass} onChange={(e) => setDefaultClass(e.target.value)} maxLength={40} dir="auto" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          {accounts.length > 0 && (
            <label className="block text-xs text-slate-700">
              Usual fee account
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Ask me each time</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <p className="text-[11px] text-slate-500">Anything you say in a message wins over these. Leave a field empty to make Aura forget it.</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {saved && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">Saved.</p>}
          <button type="submit" disabled={save.isPending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40">Save</button>
        </form>
      )}
    </div>
  )
}
