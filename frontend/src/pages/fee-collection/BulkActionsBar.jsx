import { useState } from 'react'

export default function BulkActionsBar({ selectedCount, onBulkUpdate, onBulkDelete, isPending, accountsList }) {
  const [bulkAmount, setBulkAmount] = useState('')
  const [bulkAccount, setBulkAccount] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-xl shadow-2xl border border-gray-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-center gap-3 max-w-2xl">
      <span className="text-sm font-medium text-gray-700">{selectedCount} selected</span>

      <div className="w-px h-8 bg-gray-200 hidden sm:block" />

      {/* Bulk set paid amount + account */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          step="0.01"
          placeholder="Paid amount"
          value={bulkAmount}
          onChange={(e) => setBulkAmount(e.target.value)}
          className="input-field text-sm w-28 py-1"
        />
        <select
          value={bulkAccount}
          onChange={(e) => setBulkAccount(e.target.value)}
          className="input-field text-sm w-36 py-1"
        >
          <option value="">-- Select Account --</option>
          {(accountsList || []).filter(a => a.is_active).map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (!bulkAccount) {
              alert('Please select account')
              return
            }
            if (bulkAmount) {
              onBulkUpdate(parseFloat(bulkAmount), parseInt(bulkAccount))
              setBulkAmount('')
            }
          }}
          disabled={!bulkAmount || !bulkAccount || isPending}
          className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
        >
          Update
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200 hidden sm:block" />

      {/* Bulk delete */}
      {showDeleteConfirm ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-red-600">Delete all?</span>
          <button
            onClick={() => { onBulkDelete(); setShowDeleteConfirm(false) }}
            disabled={isPending}
            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs disabled:opacity-50"
          >
            Yes
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isPending}
          className="px-3 py-1.5 text-red-600 border border-red-300 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  )
}
