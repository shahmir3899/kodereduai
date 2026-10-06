import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import { TONE } from '../../components/ui/statusTones'
import Button from '../../components/ui/Button'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../services/api'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

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
  const [view, setView] = useViewPreference('stock-transactions')
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
      // This page's own item list/dropdown reads ['inventoryItemsAll'], a
      // separate key from ['inventoryItems'] used elsewhere — refresh it too
      // so the stock count shown here updates without a reload.
      queryClient.invalidateQueries({ queryKey: ['inventoryItemsAll'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryDashboard'] })
      closeModal()
    },
  })

  const openModal = () => {
    setTxForm(emptyTxForm)
    setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setTxForm(emptyTxForm) }

  useEscapeKey(closeModal, showModal)

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
    PURCHASE: TONE.success,
    ISSUE: TONE.danger,
    RETURN: TONE.info,
    ADJUSTMENT: TONE.neutral,
    DISPOSAL: TONE.orange,
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
      <PageHeader title="Stock Transactions" subtitle="Record and view stock movements" className="mb-6" actions={<>
<button
          onClick={openModal}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
        >
          + Record Transaction
        </button>
</>} />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Type</label>
            <select
              className="input"
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
              className="input"
              value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">To Date</label>
            <input type="date"
              className="input"
              value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <div className="text-center py-16">
            <LoadingState label="Loading transactions..." compact />
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
            <div className="flex justify-end p-2">
              <ViewToggle view={view} onChange={setView} />
            </div>

            {view === 'cards' ? (
            <CardGrid className="p-2">
              {transactions.map((tx) => (
                <RecordCard
                  key={tx.id}
                  title={tx.item_name || tx.item?.name || '-'}
                  meta={formatDate(tx.date)}
                  status={
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${txTypeColors[tx.transaction_type] || TONE.neutral}`}>
                      {tx.transaction_type}
                    </span>
                  }
                  fields={[
                    {
                      label: 'Qty',
                      value: <span className={tx.quantity > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{tx.quantity > 0 ? '+' : ''}{tx.quantity}</span>,
                    },
                    { label: 'Amount', value: `Rs ${Number(tx.total_amount || 0).toLocaleString()}` },
                    ...(tx.reference_number ? [{ label: 'Ref', value: tx.reference_number, mono: true }] : []),
                    ...(tx.vendor_name ? [{ label: 'Vendor', value: tx.vendor_name }] : []),
                    ...(tx.recorded_by_name ? [{ label: 'By', value: tx.recorded_by_name }] : []),
                  ]}
                />
              ))}
            </CardGrid>
            ) : (
            <div className="overflow-x-auto">
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
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(tx.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{tx.item_name || tx.item?.name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${txTypeColors[tx.transaction_type] || TONE.neutral}`}>
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
            )}
          </>
        )}
      </div>

      {/* ============ Record Transaction Modal ============ */}
      {showModal && (
        <Modal open  size="lg" closeOnBackdrop={false}>
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
                  className="input"
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
                    className="input"
                    value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Unit Price (Rs)</label>
                  <input type="number" min="0" step="0.01"
                    className="input"
                    value={txForm.unit_price} onChange={(e) => setTxForm({ ...txForm, unit_price: e.target.value })} />
                </div>
              </div>

              {txForm.transaction_type === 'PURCHASE' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Vendor</label>
                  <select
                    className="input"
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
                    className="input"
                    value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Reference #</label>
                  <input type="text" placeholder="Invoice/PO number"
                    className="input"
                    value={txForm.reference_number} onChange={(e) => setTxForm({ ...txForm, reference_number: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Remarks</label>
                <textarea rows={2}
                  className="input"
                  value={txForm.remarks} onChange={(e) => setTxForm({ ...txForm, remarks: e.target.value })} />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button variant="secondary" type="button" onClick={closeModal}>Cancel</Button>
                <button type="submit" disabled={createTxMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {createTxMutation.isPending ? 'Saving...' : 'Record Transaction'}
                </button>
              </div>
            </form>
          </Modal>
      )}
    </div>
  )
}
