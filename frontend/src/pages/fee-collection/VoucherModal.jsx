import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { financeApi } from '../../services/api'
import { schoolToday } from '../../utils/schoolTime'

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const money = (v) => Number(v || 0).toLocaleString()

// The school's due day in the voucher month; when that day has already passed (printing late),
// a week from today instead, so a parent is never handed a voucher that is already overdue.
export function defaultDueDate(year, month, dueDay, today) {
  const usual = `${year}-${pad(month)}-${pad(Math.min(Number(dueDay) || 10, 28))}`
  if (usual >= today) return { date: usual, late: false, usual }
  const t = new Date(`${today}T00:00:00`)
  t.setDate(t.getDate() + 7)
  return { date: isoDate(t), late: true, usual }
}

/** One student's voucher (school copy) as the PDF prints it, for the in-app preview. */
function VoucherCard({ v, data }) {
  const discount = Number(v.discount || 0)
  const paid = Number(v.paid || 0)
  return (
    <div className="rounded border border-gray-300 bg-white p-3 text-xs text-gray-800">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-bold">{data.school_name}</p>
          <p className="text-gray-500">Fee Voucher - {v.month_label}</p>
        </div>
        <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] font-bold">SCHOOL COPY</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 border-t pt-1">
        <p>Voucher #: <b>{v.voucher_number}</b></p><p>Due date: <b>{v.due_date}</b></p>
        <p>Student: <b>{v.student_name}</b></p><p>Class: <b>{v.class_label}</b></p>
      </div>
      <table className="mt-2 w-full">
        <tbody>
          {v.lines.map((l) => (
            <tr key={l.label}><td>{l.label}</td><td className="text-right">{money(l.amount)}</td></tr>
          ))}
          <tr className="border-t"><td>Current charges</td><td className="text-right">{money(v.current_total)}</td></tr>
          {discount > 0 && <tr><td>Less: discount</td><td className="text-right">-{money(discount)}</td></tr>}
          <tr><td>Previous unpaid</td><td className="text-right">{money(v.previous_unpaid)}</td></tr>
          {paid > 0 && <tr><td>Less: already paid</td><td className="text-right">-{money(paid)}</td></tr>}
          <tr className="text-sm font-bold"><td>Total payable</td><td className="text-right">{money(v.total_payable)}</td></tr>
        </tbody>
      </table>
      <div className="mt-2 flex gap-2">
        {data.bank && (
          <div className="flex-1 rounded border p-1.5">
            <p className="font-semibold">Pay at bank</p>
            <p>{data.bank.bank_name}</p>
            {data.bank.account_number && <p>A/C: {data.bank.account_number}</p>}
          </div>
        )}
        {v.kuickpay_number && (
          <div className="flex-1 rounded border p-1.5">
            <p className="font-semibold">Pay via Kuickpay</p>
            <p className="text-sm font-bold">{v.kuickpay_number}</p>
          </div>
        )}
      </div>
      {data.note && <p className="mt-1 italic text-gray-500">{data.note}</p>}
    </div>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Print fee vouchers for the students on screen (or the selected rows), plus the school's voucher
 * settings (due day, bank account, note). Settings live here because this is where they are used;
 * only admins can change them (the API enforces it too).
 */
export default function VoucherModal({ open, onClose, month, year, studentIds, scopeParams, scopeLabel, canEditSettings }) {
  const queryClient = useQueryClient()
  const [onlyUnpaid, setOnlyUnpaid] = useState(true)
  const [error, setError] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [preview, setPreview] = useState(null)
  const [form, setForm] = useState({ due_day: 10, voucher_bank_account_id: '', voucher_note: '' })

  const { data: settings } = useQuery({
    queryKey: ['voucherSettings'],
    queryFn: () => financeApi.getVoucherSettings().then((r) => r.data),
    enabled: open,
  })

  const today = schoolToday()
  const due = settings ? defaultDueDate(year, month, settings.due_day, today) : null
  useEffect(() => {
    if (due) setDueDate(due.date)
  }, [settings?.due_day, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings) {
      setForm({
        due_day: settings.due_day,
        voucher_bank_account_id: settings.voucher_bank_account_id || '',
        voucher_note: settings.voucher_note || '',
      })
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (data) => financeApi.updateVoucherSettings(data),
    onSuccess: (res) => queryClient.setQueryData(['voucherSettings'], res.data),
  })

  const voucherParams = () => {
    const params = { month, year, only_unpaid: onlyUnpaid ? 1 : 0, ...scopeParams }
    if (studentIds) params.student_ids = studentIds.join(',')
    if (dueDate) params.due_date = dueDate
    return params
  }

  const previewMutation = useMutation({
    mutationFn: () => financeApi.previewFeeVouchers(voucherParams()).then((r) => r.data),
    onSuccess: (data) => {
      if (!data.count) setError('No vouchers: nobody in this list owes anything for this month.')
      setPreview(data)
    },
    onError: () => setError('Could not load the preview.'),
  })

  const printMutation = useMutation({
    mutationFn: async () => {
      const params = voucherParams()
      const res = await financeApi.downloadFeeVouchers(params)
      return { blob: res.data, count: Number(res.headers?.['x-voucher-count'] ?? -1) }
    },
    onSuccess: ({ blob, count }) => {
      if (count === 0) {
        setError('No vouchers: nobody in this list owes anything for this month.')
        return
      }
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `fee-vouchers-${year}-${String(month).padStart(2, '0')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      onClose()
    },
    onError: () => setError('Could not create the vouchers. Please try again.'),
  })

  const settingsChanged = settings && (
    Number(form.due_day) !== settings.due_day
    || String(form.voucher_bank_account_id || '') !== String(settings.voucher_bank_account_id || '')
    || form.voucher_note !== (settings.voucher_note || '')
  )

  const handleSaveSettings = () => {
    setError('')
    saveMutation.mutate({
      due_day: Number(form.due_day),
      voucher_bank_account_id: form.voucher_bank_account_id ? Number(form.voucher_bank_account_id) : null,
      voucher_note: form.voucher_note,
    }, {
      onError: (err) => setError(err.response?.data?.detail || 'Could not save the settings.'),
    })
  }

  const count = studentIds ? studentIds.length : null
  const banks = settings?.bank_accounts || []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Print fee vouchers"
      size="3xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="secondary"
          onClick={() => { setError(''); previewMutation.mutate() }}
          disabled={previewMutation.isPending || settingsChanged}
        >
          {previewMutation.isPending ? 'Loading…' : 'Preview'}
        </Button>
        <Button
          onClick={() => { setError(''); printMutation.mutate() }}
          disabled={printMutation.isPending || settingsChanged}
        >
          {printMutation.isPending ? 'Preparing PDF…' : 'Download PDF'}
        </Button>
      </>}
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <p><span className="text-gray-500">Month:</span> <strong>{MONTHS[month - 1]} {year}</strong></p>
          <p><span className="text-gray-500">Students:</span> <strong>{count !== null ? `${count} selected` : scopeLabel}</strong></p>
          <p className="mt-1 text-xs text-gray-500">
            A4 paper, 3 students per page. Each student gets a School copy and a Student copy.
            The total includes all unpaid dues from earlier months.
          </p>
        </div>

        <label className="block max-w-xs">
          <span className="label">Due date on these vouchers</span>
          <input type="date" className="input" value={dueDate} min={today}
            onChange={(e) => { setDueDate(e.target.value); setPreview(null) }} />
        </label>
        {due?.late && (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
            The school's due date for this month ({due.usual}) has passed, so these vouchers are due a week from today. Change it above if needed.
          </p>
        )}

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} />
          Only students who still owe money
        </label>

        <div className="border-t pt-4 dark:border-gray-700">
          <h3 className="mb-2 font-semibold">Voucher settings (this school)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Due day of the month</span>
              <select
                className="input"
                value={form.due_day}
                disabled={!canEditSettings}
                onChange={(e) => setForm((f) => ({ ...f, due_day: e.target.value }))}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Bank account printed</span>
              <select
                className="input"
                value={form.voucher_bank_account_id}
                disabled={!canEditSettings}
                onChange={(e) => setForm((f) => ({ ...f, voucher_bank_account_id: e.target.value }))}
              >
                <option value="">None</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.account_number ? ` (${b.account_number})` : ''}</option>
                ))}
              </select>
            </label>
          </div>
          {banks.length === 0 && (
            <p className="mt-1 text-xs text-gray-500">No bank account yet. Add one with bank details under Finance → Accounts.</p>
          )}
          <label className="mt-3 block">
            <span className="label">Note on voucher <span className="font-normal text-gray-400">(optional)</span></span>
            <input
              className="input"
              maxLength={150}
              value={form.voucher_note}
              disabled={!canEditSettings}
              placeholder="e.g. A late fee of Rs 200 applies after the due date."
              onChange={(e) => setForm((f) => ({ ...f, voucher_note: e.target.value }))}
            />
          </label>
          {settings?.kuickpay_enabled && (
            <p className="mt-2 text-xs text-gray-500">Kuickpay is on: each voucher also shows the student's Kuickpay number. The due day is used for Kuickpay bills too.</p>
          )}
          {canEditSettings && settingsChanged && (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={handleSaveSettings} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save settings'}
              </Button>
              <span className="text-xs text-gray-500">Save before downloading.</span>
            </div>
          )}
        </div>

        {preview?.count > 0 && (
          <div className="rounded-lg bg-gray-100 p-3" aria-label="Voucher preview">
            <p className="mb-2 text-xs text-gray-600">
              Preview: {preview.count} voucher{preview.count === 1 ? '' : 's'}, 3 students per A4 page. First ones shown; the PDF also has a student copy of each.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {preview.vouchers.slice(0, 2).map((v) => <VoucherCard key={v.student_id} v={v} data={preview} />)}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
