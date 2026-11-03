import { MONTH_NAMES, formatMoney } from './feeCollect';

// Response of GET /api/parents/children/<id>/kuickpay-bill/ (finance/kuickpay/parent_summary.py).
// Only the one open bill is ever active; a suspended bill carries a neutral message and no reason.
export interface KuickpayActiveBill {
  consumer_number: string;
  biller_name: string;
  cycle: { year: number; month: number };
  status: 'ACTIVE' | 'SUSPENDED';
  payable: boolean;
  payable_amount: string;
  processing_amount: string;
  scope_note: string;
  message: string;
}

export interface KuickpayBillSummary {
  enabled: boolean;
  active_bill: KuickpayActiveBill | null;
}

export type KuickpayBillCardState =
  | { kind: 'pay'; title: string; month: string; number: string; amount: string; processing: string | null; note: string }
  | { kind: 'suspended'; title: string; month: string; message: string }
  | { kind: 'settled'; title: string; month: string };

// What the parent's card shows, or null when it should not appear at all (the school does not use
// Kuickpay, or the child has no open bill). A number appears only while something is payable.
export function kuickpayBillCard(summary: KuickpayBillSummary | null | undefined): KuickpayBillCardState | null {
  const bill = summary?.enabled ? summary.active_bill : null;
  if (!bill) return null;
  const title = `Pay through ${bill.biller_name}`;
  const month = `${MONTH_NAMES[bill.cycle.month - 1] ?? bill.cycle.month} ${bill.cycle.year}`;
  if (bill.status === 'SUSPENDED') return { kind: 'suspended', title, month, message: bill.message };
  const amount = Number(bill.payable_amount) || 0;
  if (amount <= 0) return { kind: 'settled', title, month };
  const processing = Number(bill.processing_amount) || 0;
  return {
    kind: 'pay', title, month, number: bill.consumer_number, amount: formatMoney(amount),
    processing: processing > 0 ? formatMoney(processing) : null, note: bill.scope_note,
  };
}
