import { TONE } from './ui/statusTones'

/**
 * The small "received via Kuickpay" label on a fee record. The backend sends `kuickpay` on every fee
 * row (null when nothing came in through Kuickpay), already worded, so staff, teachers, parents and
 * students all see the same text. See finance/kuickpay/received.py.
 *
 * kuickpay: { label, coverage: 'FULL'|'PARTIAL', reference_text, payments: [{reference, receipt, date, amount}] }
 */
function dayLabel(iso) {
  // Built from the parts so a date-only string never shifts a day with the viewer's time zone.
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString()
}

export default function KuickpayReceived({ kuickpay, className = '' }) {
  if (!kuickpay) return null
  const payments = kuickpay.payments || []
  const details = payments
    .map((p) => `Ref ${p.reference} · receipt ${p.receipt} · ${dayLabel(p.date)} · PKR ${Number(p.amount).toLocaleString()}`)
    .join('\n')
  const reference = payments.length === 1
    ? `${kuickpay.reference_text} · ${dayLabel(payments[0].date)}`
    : kuickpay.reference_text
  const tone = kuickpay.coverage === 'FULL' ? TONE.success : TONE.info
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left font-normal ${className}`}
      title={details}
      data-testid="kuickpay-received"
      onClick={(e) => e.stopPropagation()}
    >
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight ${tone}`}>
        {kuickpay.label}
      </span>
      <span className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">{reference}</span>
    </div>
  )
}
