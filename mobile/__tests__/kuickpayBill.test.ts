import { kuickpayBillCard, type KuickpayActiveBill } from '../services/kuickpayBill';

const bill = (over: Partial<KuickpayActiveBill> = {}): KuickpayActiveBill => ({
  consumer_number: '015203268489', biller_name: 'Kuickpay', cycle: { year: 2026, month: 11 },
  status: 'ACTIVE', payable: true, payable_amount: '2150.00', processing_amount: '0.00',
  scope_note: 'This bill covers monthly fees only.', message: '', ...over,
});

describe('kuickpayBillCard', () => {
  it('shows nothing for a school without Kuickpay, a child without an open bill, or no data yet', () => {
    expect(kuickpayBillCard(undefined)).toBeNull();
    expect(kuickpayBillCard(null)).toBeNull();
    expect(kuickpayBillCard({ enabled: false, active_bill: null })).toBeNull();
    expect(kuickpayBillCard({ enabled: true, active_bill: null })).toBeNull();
  });

  it('gives the number, the amount and the month while something is payable', () => {
    const card = kuickpayBillCard({ enabled: true, active_bill: bill() });
    expect(card).toEqual({
      kind: 'pay', title: 'Pay through Kuickpay', month: 'November 2026', number: '015203268489',
      amount: expect.stringContaining('2,150'), processing: null, note: 'This bill covers monthly fees only.',
    });
  });

  it('mentions money still being processed', () => {
    const card = kuickpayBillCard({ enabled: true, active_bill: bill({ processing_amount: '500.00' }) });
    expect(card?.kind === 'pay' && card.processing).toContain('500');
  });

  it('gives only the neutral message, never a number, for a suspended bill', () => {
    const card = kuickpayBillCard({
      enabled: true,
      active_bill: bill({ status: 'SUSPENDED', payable: false, message: 'Online payment is temporarily unavailable for this child. Please contact the school office.' }),
    });
    expect(card).toEqual({
      kind: 'suspended', title: 'Pay through Kuickpay', month: 'November 2026',
      message: 'Online payment is temporarily unavailable for this child. Please contact the school office.',
    });
    expect(JSON.stringify(card)).not.toContain('015203268489');
  });

  it('shows no number once nothing is left to pay', () => {
    const card = kuickpayBillCard({ enabled: true, active_bill: bill({ payable: false, payable_amount: '0.00' }) });
    expect(card).toEqual({ kind: 'settled', title: 'Pay through Kuickpay', month: 'November 2026' });
  });
});
