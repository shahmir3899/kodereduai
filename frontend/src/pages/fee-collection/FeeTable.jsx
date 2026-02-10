import { useRef } from 'react'
import { MONTHS } from './FeeFilters'

const statusBadge = (status) => {
  const styles = {
    PAID: 'bg-green-100 text-green-800',
    PARTIAL: 'bg-yellow-100 text-yellow-800',
    UNPAID: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  )
}

export default function FeeTable({
  paymentList, isLoading, month, year,
  selectedIds, onToggleSelect, onToggleSelectAll,
  editingCell, setEditingCell, editValue, setEditValue,
  onInlineUpdate, onRecordPayment, onSetStudentFee, onDelete,
}) {
  const headerCheckboxRef = useRef(null)

  // Manage indeterminate state
  const allSelected = paymentList.length > 0 && selectedIds.size === paymentList.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < paymentList.length
  if (headerCheckboxRef.current) {
    headerCheckboxRef.current.indeterminate = someSelected
  }

  if (isLoading) {
    return <div className="card"><div className="text-center py-8 text-gray-500">Loading...</div></div>
  }

  if (paymentList.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <p className="text-gray-500 mb-2">No fee records for {MONTHS[month - 1]} {year}</p>
          <p className="text-sm text-gray-400">Click "Generate Records" to create fee entries for students</p>
        </div>
      </div>
    )
  }

  const handleCellClick = (id, field, currentValue) => {
    setEditingCell({ id, field })
    setEditValue(String(currentValue))
  }

  const handleKeyDown = (e, paymentId, field) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onInlineUpdate(paymentId, field, editValue)
    }
    if (e.key === 'Escape') {
      setEditingCell(null)
    }
  }

  return (
    <div className="card">
      {/* Mobile card view */}
      <div className="sm:hidden space-y-3">
        {paymentList.map((payment) => {
          const monthlyFee = Number(payment.amount_due) - Number(payment.previous_balance || 0)
          const balance = Number(payment.amount_due) - Number(payment.amount_paid)
          const isSelected = selectedIds.has(payment.id)
          return (
            <div key={payment.id} className={`border rounded-lg p-3 ${isSelected ? 'border-primary-400 bg-primary-50' : ''}`}>
              <div className="flex items-start gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(payment.id)}
                  className="mt-1 rounded border-gray-300"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{payment.student_name}</p>
                      <p className="text-xs text-gray-500">{payment.class_name} - Roll #{payment.student_roll}</p>
                    </div>
                    {statusBadge(payment.status)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                <div>
                  <p className="text-xs text-gray-500">Total Payable</p>
                  <p className="font-medium">{Number(payment.amount_due).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Received</p>
                  <p className="font-medium text-green-700">{Number(payment.amount_paid).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Balance</p>
                  <p className="font-medium text-orange-700">{balance.toLocaleString()}</p>
                </div>
              </div>
              {Number(payment.previous_balance) > 0 && (
                <p className="text-xs text-orange-600 mb-2">
                  Prev balance: {Number(payment.previous_balance).toLocaleString()} + Fee: {monthlyFee.toLocaleString()}
                </p>
              )}
              <div className="flex gap-2">
                {payment.status !== 'PAID' && (
                  <button
                    onClick={() => onRecordPayment(payment, balance)}
                    className="text-xs px-3 py-1.5 bg-primary-600 text-white rounded hover:bg-primary-700"
                  >
                    Record Payment
                  </button>
                )}
                <button
                  onClick={() => onSetStudentFee(payment, monthlyFee)}
                  className="text-xs px-2 py-1.5 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                >
                  Fee
                </button>
                <button
                  onClick={() => onDelete(payment.id)}
                  className="text-xs px-2 py-1.5 text-red-600 border border-red-300 rounded hover:bg-red-50"
                >
                  Del
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-center w-10">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Prev Bal</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monthly Fee</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Payable</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Received</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paymentList.map((payment) => {
              const prevBal = Number(payment.previous_balance || 0)
              const monthlyFee = Number(payment.amount_due) - prevBal
              const balance = Number(payment.amount_due) - Number(payment.amount_paid)
              const isSelected = selectedIds.has(payment.id)
              const isEditingReceived = editingCell?.id === payment.id && editingCell?.field === 'amount_paid'
              return (
                <tr key={payment.id} className={isSelected ? 'bg-primary-50' : ''}>
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(payment.id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-900">{payment.student_name}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{payment.class_name}</td>
                  <td className={`px-3 py-3 text-sm text-right ${prevBal > 0 ? 'text-orange-700 font-medium' : 'text-gray-400'}`}>
                    {prevBal > 0 ? prevBal.toLocaleString() : '\u2014'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-900 text-right">{monthlyFee.toLocaleString()}</td>
                  <td className="px-3 py-3 text-sm font-medium text-gray-900 text-right">{Number(payment.amount_due).toLocaleString()}</td>
                  <td
                    className="px-3 py-3 text-sm text-green-700 text-right cursor-pointer hover:bg-green-50 transition-colors"
                    onClick={() => !isEditingReceived && handleCellClick(payment.id, 'amount_paid', payment.amount_paid)}
                    title="Click to edit"
                  >
                    {isEditingReceived ? (
                      <input
                        type="number"
                        step="0.01"
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => onInlineUpdate(payment.id, 'amount_paid', editValue)}
                        onKeyDown={(e) => handleKeyDown(e, payment.id, 'amount_paid')}
                        className="w-20 text-right input-field text-sm py-0.5 px-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      Number(payment.amount_paid).toLocaleString()
                    )}
                  </td>
                  <td className={`px-3 py-3 text-sm font-medium text-right ${balance > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                    {balance.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-center">{statusBadge(payment.status)}</td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {payment.status !== 'PAID' && (
                        <button
                          onClick={() => onRecordPayment(payment, balance)}
                          className="text-sm px-3 py-1 bg-primary-600 text-white rounded hover:bg-primary-700"
                        >
                          Pay
                        </button>
                      )}
                      <button
                        onClick={() => onSetStudentFee(payment, monthlyFee)}
                        title="Set custom fee for this student"
                        className="text-xs px-2 py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                      >
                        Fee
                      </button>
                      <button
                        onClick={() => onDelete(payment.id)}
                        title="Delete fee record"
                        className="text-xs px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
