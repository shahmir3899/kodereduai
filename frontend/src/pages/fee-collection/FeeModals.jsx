import { useState } from 'react'
import { MONTHS } from './FeeFilters'

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'ONLINE', label: 'Online Payment' },
  { value: 'OTHER', label: 'Other' },
]

const INCOME_CATEGORIES = [
  { value: 'SALE', label: 'Sale (Books/Copies/Uniform)' },
  { value: 'DONATION', label: 'Donation' },
  { value: 'EVENT', label: 'Event Income' },
  { value: 'MISC', label: 'Miscellaneous' },
]

// Helper to extract readable error from DRF responses
const getErrorMessage = (error, fallback = 'Something went wrong') => {
  const data = error?.response?.data
  if (!data) return fallback
  if (typeof data === 'string') return data
  if (data.detail) return data.detail
  if (data.non_field_errors) return data.non_field_errors.join(', ')
  const messages = []
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) messages.push(`${key}: ${val.join(', ')}`)
    else if (typeof val === 'string') messages.push(`${key}: ${val}`)
  }
  return messages.length > 0 ? messages.join('; ') : fallback
}

export function PaymentModal({ payment, form, setForm, onSubmit, onClose, isPending, error, accountsList }) {
  const [showConfirm, setShowConfirm] = useState(false)
  if (!payment) return null

  const selectedAccount = accountsList.find(a => String(a.id) === String(form.account))
  const selectedMethod = PAYMENT_METHODS.find(m => m.value === form.payment_method)

  const handleFormSubmit = (e) => {
    e.preventDefault()
    setShowConfirm(true)
  }

  const handleConfirm = () => {
    onSubmit({ preventDefault: () => {} })
    setShowConfirm(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-1">Record Payment</h3>
          <p className="text-sm text-gray-500 mb-4">
            {payment.student_name} - {payment.class_name}
            <br />
            Total Payable: {Number(payment.amount_due).toLocaleString()} | Already Paid: {Number(payment.amount_paid).toLocaleString()}
            {Number(payment.previous_balance) > 0 && (
              <><br /><span className="text-orange-600">Includes {Number(payment.previous_balance).toLocaleString()} carry-forward balance</span></>
            )}
          </p>

          {showConfirm ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <p className="text-sm font-medium text-blue-900">Please confirm this payment:</p>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><span className="font-medium">Student:</span> {payment.student_name}</p>
                  <p><span className="font-medium">Amount:</span> {Number(form.amount_paid).toLocaleString()}</p>
                  <p><span className="font-medium">Account:</span> {selectedAccount?.name || '-'}</p>
                  <p><span className="font-medium">Method:</span> {selectedMethod?.label || form.payment_method}</p>
                  <p><span className="font-medium">Date:</span> {form.payment_date}</p>
                  {form.receipt_number && <p><span className="font-medium">Receipt #:</span> {form.receipt_number}</p>}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                <button onClick={handleConfirm} disabled={isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                  {isPending ? 'Saving...' : 'Confirm Payment'}
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to record payment')}</p>}
            </div>
          ) : (
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <input
                  type="number" step="0.01"
                  value={form.amount_paid}
                  onChange={(e) => setForm(f => ({ ...f, amount_paid: e.target.value }))}
                  className="input-field" required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select value={form.payment_method} onChange={(e) => setForm(f => ({ ...f, payment_method: e.target.value }))} className="input-field">
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-red-500">*</span></label>
                <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input-field" required>
                  <option value="">-- Select Account --</option>
                  {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm(f => ({ ...f, payment_date: e.target.value }))} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Receipt # (optional)</label>
                <input type="text" value={form.receipt_number} onChange={(e) => setForm(f => ({ ...f, receipt_number: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                  Review Payment
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to record payment')}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export function GenerateModal({ show, onClose, month, year, classFilter, setClassFilter, classList, mutation, existingCount = 0 }) {
  const [confirmed, setConfirmed] = useState(false)
  if (!show) return null

  const hasExisting = existingCount > 0
  const canGenerate = !hasExisting || confirmed

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Generate Fee Records</h3>
          <p className="text-sm text-gray-600 mb-2">
            This will create fee payment records for all active students for <strong>{MONTHS[month - 1]} {year}</strong>.
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Unpaid balances from the previous month will be automatically carried forward.
          </p>
          {hasExisting && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800 font-medium">
                {existingCount} record(s) already exist for {MONTHS[month - 1]} {year}.
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Existing records will NOT be overwritten. Only new students without records will be added.
              </p>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
                <span className="text-sm text-amber-700">I understand, proceed anyway</span>
              </label>
            </div>
          )}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Class (optional)</label>
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="input-field">
              <option value="">All Classes</option>
              {classList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setConfirmed(false); onClose() }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
            <button
              onClick={() => mutation.mutate({ month, year, ...(classFilter && { class_id: parseInt(classFilter) }) })}
              disabled={mutation.isPending || !canGenerate}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              {mutation.isPending ? 'Generating...' : 'Generate'}
            </button>
          </div>
          {mutation.isError && (
            <div className="mt-3 text-sm text-red-700 bg-red-50 p-3 rounded">
              {getErrorMessage(mutation.error, 'Failed to generate fee records')}
            </div>
          )}
          {mutation.isSuccess && (
            <div className="mt-3 text-sm text-green-700 bg-green-50 p-3 rounded">
              Created {mutation.data?.data?.created} records.
              {mutation.data?.data?.skipped > 0 && ` Skipped ${mutation.data.data.skipped} (already exist).`}
              {mutation.data?.data?.no_fee_structure > 0 && ` ${mutation.data.data.no_fee_structure} students have no fee structure.`}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function FeeStructureModal({ show, onClose, classList, bulkFees, setBulkFees, bulkEffectiveFrom, setBulkEffectiveFrom, onSubmit, mutation }) {
  const [showConfirm, setShowConfirm] = useState(false)
  if (!show) return null

  const feesWithValues = classList.filter(c => bulkFees[c.id] && Number(bulkFees[c.id]) > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-6 flex-shrink-0">
          <h3 className="text-lg font-semibold mb-1">Set Fee Structure</h3>
          <p className="text-sm text-gray-600 mb-4">Set the monthly fee for each class. Leave blank to skip a class.</p>
          {!showConfirm && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
              <input type="date" value={bulkEffectiveFrom} onChange={(e) => setBulkEffectiveFrom(e.target.value)} className="input-field" />
            </div>
          )}
        </div>

        {showConfirm ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium text-blue-900 mb-2">Please confirm fee structure changes:</p>
                <p className="text-xs text-blue-700 mb-3">Effective from: {bulkEffectiveFrom}</p>
                <div className="space-y-1">
                  {feesWithValues.length > 0 ? feesWithValues.map(c => (
                    <p key={c.id} className="text-sm text-blue-800">
                      <span className="font-medium">{c.name}:</span> {Number(bulkFees[c.id]).toLocaleString()}/month
                    </p>
                  )) : (
                    <p className="text-sm text-blue-800">No fees set. Nothing will be saved.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="p-6 flex gap-3 border-t flex-shrink-0">
              <button type="button" onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
              <button
                onClick={(e) => { onSubmit(e); setShowConfirm(false) }}
                disabled={mutation.isPending || feesWithValues.length === 0}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >
                {mutation.isPending ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
            {mutation.isError && <p className="px-6 pb-4 text-sm text-red-600">{getErrorMessage(mutation.error, 'Failed to save fee structures')}</p>}
            {mutation.isSuccess && <p className="px-6 pb-4 text-sm text-green-600">Fee structures saved for {mutation.data?.data?.created} classes!</p>}
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setShowConfirm(true) }} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6">
              <table className="min-w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Monthly Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {classList.map(c => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 text-sm text-gray-900">{c.name}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.01" placeholder="0.00"
                          value={bulkFees[c.id] || ''}
                          onChange={(e) => setBulkFees(f => ({ ...f, [c.id]: e.target.value }))}
                          className="input-field text-sm text-right w-32 ml-auto"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-6 flex gap-3 border-t flex-shrink-0">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                Review Changes
              </button>
            </div>
            {mutation.isError && <p className="px-6 pb-4 text-sm text-red-600">{getErrorMessage(mutation.error, 'Failed to save fee structures')}</p>}
            {mutation.isSuccess && <p className="px-6 pb-4 text-sm text-green-600">Fee structures saved for {mutation.data?.data?.created} classes!</p>}
          </form>
        )}
      </div>
    </div>
  )
}

export function IncomeModal({ show, onClose, form, setForm, onSubmit, isPending, error, accountsList }) {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Add Other Income</h3>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                {INCOME_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-red-500">*</span></label>
              <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input-field" required>
                <option value="">-- Select Account --</option>
                {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="input-field" rows={2} placeholder="e.g., Sold 50 copies" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to save income')}</p>}
          </form>
        </div>
      </div>
    </div>
  )
}

export function StudentFeeModal({ student, amount, setAmount, onSubmit, onClose, isPending, error, isSuccess }) {
  if (!student) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-1">Set Student Fee</h3>
          <p className="text-sm text-gray-500 mb-4">
            Override the class-level fee for <strong>{student.student_name}</strong> ({student.class_name}).
            This will apply from next month's generation onwards.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Fee Amount</label>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" required />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to set student fee')}</p>}
            {isSuccess && <p className="text-sm text-green-600">Student fee override saved! It will apply on next month's generation.</p>}
          </form>
        </div>
      </div>
    </div>
  )
}

export function DeleteConfirmModal({ show, message, onConfirm, onCancel, isPending }) {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold mb-2 text-red-700">Confirm Delete</h3>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={isPending} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-50 text-sm disabled:opacity-50">
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
