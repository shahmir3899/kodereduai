import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../services/api'

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const TX_TYPES = [
  { value: 'PURCHASE', label: 'Purchase', desc: 'Incoming stock from vendor' },
  { value: 'ADJUSTMENT', label: 'Adjustment', desc: 'Correct stock count' },
  { value: 'DISPOSAL', label: 'Disposal', desc: 'Damaged or expired items' },
]

const emptyTxForm = {
  item: '', transaction_type: 'PURCHASE', quantity: '',
  unit_price: '', vendor: '', reference_number: '', remarks: '',
  date: new Date().toISOString().split('T')[0],
}

export default function StockTransactionsPage() {
  const queryClient = useQueryClient()

  // Filters
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [txForm, setTxForm] = useState(emptyTxForm)

  // ---- Queries ----
  const { data: txData, isLoading } = useQuery({
    queryKey: ['inventoryTransactions', typeFilter, dateFrom, dateTo],
    queryFn: () => inventoryApi.getTransactions({
      transaction_type: typeFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
  })

  const { data: itemsData } = useQuery({
    queryKey: ['inventoryItemsAll'],
    queryFn: () => inventoryApi.getItems({ page_size: 1000 }),
  })

  const { data: vendorsData } = useQuery({
    queryKey: ['inventoryVendors'],
    queryFn: () => inventoryApi.getVendors(),
  })

  const transactions = txData?.data?.results || txData?.data || []
  const items = itemsData?.data?.results || itemsData?.data || []
  const vendors = vendorsData?.data?.results || vendorsData?.data || []

  // ---- Mutations ----
  const createTxMutation = useMutation({
    mutationFn: (data) => inventoryApi.createTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryTransactions'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryDashboard'] })
      closeModal()
    },
  })

  const openModal = () => {
    setTxForm(emptyTxForm)
    setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setTxForm(emptyTxForm) }

  const handleSubmit = (e) => {
    e.preventDefault()
    const qty = Number(txForm.quantity)
    // For disposal, quantity should be negative (items leaving)
    const signedQty = txForm.transaction_type === 'DISPOSAL' ? -Math.abs(qty) : Math.abs(qty)
    // For adjustment, allow negative (correction downward) or positive
    const finalQty = txForm.transaction_type === 'ADJUSTMENT' ? qty : signedQty

    createTxMutation.mutate({
      item: parseInt(txForm.item),
      transaction_type: txForm.transaction_type,
      quantity: finalQty,
      unit_price: Number(txForm.unit_price) || 0,
      vendor: txForm.vendor ? parseInt(txForm.vendor) : null,
      reference_number: txForm.reference_number || '',
      remarks: txForm.remarks || '',
      date: txForm.date,
    })
  }

  const txTypeColors = {
    PURCHASE: 'bg-green-100 text-green-700',
    ISSUE: 'bg-red-100 text-red-700',
    RETURN: 'bg-blue-100 text-blue-700',
    ADJUSTMENT: 'bg-gray-100 text-gray-700',
    DISPOSAL: 'bg-orange-100 text-orange-700',
  }

  const errorMessage = (err) => {
    const d = err?.response?.data
    if (typeof d === 'string') return d
    if (d?.detail) return d.detail
    if (d?.non_field_errors) return d.non_field_errors[0]
    if (d) return Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join(', ')
    return err?.message || 'An error occurred.'
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Stock Transactions</h1>
          <p className="text-sm sm:text-base text-gray-600">Record and view stock movements</p>
        </div>
        <button
          onClick={openModal}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Record Transaction
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Type</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All Types</option>
              <option value="PURCHASE">Purchase</option>
              <option value="ISSUE">Issue</option>
              <option value="RETURN">Return</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="DISPOSAL">Disposal</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">From Date</label>
            <input type="date"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">To Date</label>
            <input type="date"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-3">Loading transactions...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-500 font-medium">No transactions found</p>
            <p className="text-gray-400 text-sm mt-1">
              {typeFilter || dateFrom || dateTo ? 'Try adjusting your filters.' : 'Record your first transaction to get started.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {transactions.map((tx) => (
                <div key={tx.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">{tx.item_name || tx.item?.name || '-'}</p>
                      <p className="text-xs text-gray-500">{formatDate(tx.date)}</p>
                    </div>
                    <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded text-xs font-medium ${txTypeColors[tx.transaction_type] || 'bg-gray-100 text-gray-700'}`}>
                      {tx.transaction_type}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p>
                      Qty: <span className={`font-medium ${tx.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                      </span>
                      {' | '}Amount: Rs {Number(tx.total_amount || 0).toLocaleString()}
                    </p>
                    {tx.reference_number && <p>Ref: {tx.reference_number}</p>}
                    {tx.vendor_name && <p>Vendor: {tx.vendor_name}</p>}
                    {tx.recorded_by_name && <p>By: {tx.recorded_by_name}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(tx.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{tx.item_name || tx.item?.name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${txTypeColors[tx.transaction_type] || 'bg-gray-100 text-gray-700'}`}>
                          {tx.transaction_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium">
                        <span className={tx.quantity > 0 ? 'text-green-600' : 'text-red-600'}>
                          {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">Rs {Number(tx.unit_price || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">Rs {Number(tx.total_amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{tx.vendor_name || tx.vendor?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">{tx.reference_number || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{tx.recorded_by_name || tx.recorded_by?.username || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ Record Transaction Modal ============ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Record Transaction</h2>

            {createTxMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage(createTxMutation.error)}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Transaction Type *</label>
                <div className="grid grid-cols-3 gap-2">
                  {TX_TYPES.map((t) => (
                    <button type="button" key={t.value}
                      onClick={() => setTxForm({ ...txForm, transaction_type: t.value })}
                      className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                        txForm.transaction_type === t.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {TX_TYPES.find(t => t.value === txForm.transaction_type)?.desc}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Item *</label>
                <select required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={txForm.item} onChange={(e) => setTxForm({ ...txForm, item: e.target.value })}>
                  <option value="">-- Select Item --</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name} (Stock: {i.current_stock} {i.unit})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                    Quantity * {txForm.transaction_type === 'ADJUSTMENT' && '(negative to reduce)'}
                  </label>
                  <input type="number" required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Unit Price (Rs)</label>
                  <input type="number" min="0" step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={txForm.unit_price} onChange={(e) => setTxForm({ ...txForm, unit_price: e.target.value })} />
                </div>
              </div>

              {txForm.transaction_type === 'PURCHASE' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Vendor</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={txForm.vendor} onChange={(e) => setTxForm({ ...txForm, vendor: e.target.value })}>
                    <option value="">-- Select Vendor --</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Date *</label>
                  <input type="date" required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Reference #</label>
                  <input type="text" placeholder="Invoice/PO number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={txForm.reference_number} onChange={(e) => setTxForm({ ...txForm, reference_number: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Remarks</label>
                <textarea rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={txForm.remarks} onChange={(e) => setTxForm({ ...txForm, remarks: e.target.value })} />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={createTxMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {createTxMutation.isPending ? 'Saving...' : 'Record Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
