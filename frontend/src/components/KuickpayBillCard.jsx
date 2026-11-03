import CopyableNumber from './CopyableNumber'

/**
 * The child's current Kuickpay bill, for the parent to pay from. `summary` is the response of
 * GET /api/parents/children/<id>/kuickpay-bill/ (finance/kuickpay/parent_summary.py): only the one
 * open bill is ever shown, and a suspended bill gets the server's neutral message, never a number.
 */
function monthName({ year, month }) {
  return new Date(year, month - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' })
}

export default function KuickpayBillCard({ summary }) {
  const bill = summary?.enabled ? summary.active_bill : null
  if (!bill) return null

  const month = monthName(bill.cycle)
  const amount = Number(bill.payable_amount)
  const suspended = bill.status === 'SUSPENDED'

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50 p-5 dark:border-teal-800 dark:bg-teal-900/20" data-testid="kuickpay-bill-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-teal-900 dark:text-teal-100">Pay through {bill.biller_name}</h2>
        <span className="text-xs text-teal-800 dark:text-teal-200">Bill for {month}</span>
      </div>

      {suspended ? (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">{bill.message}</p>
      ) : amount > 0 ? (
        <>
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">Consumer number</p>
          <CopyableNumber value={bill.consumer_number} textClassName="text-2xl font-semibold text-gray-900 dark:text-white" />
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">
            Amount to pay: <span className="font-semibold">PKR {amount.toLocaleString()}</span>
            {bill.processing_amount && Number(bill.processing_amount) > 0 && (
              <span className="text-gray-500"> (PKR {Number(bill.processing_amount).toLocaleString()} still being processed)</span>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{bill.scope_note}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">Nothing is due on the {month} bill.</p>
      )}
    </div>
  )
}
