import { kuickpayNote, type KuickpayReceived } from '../services/feeCollect';

const single: KuickpayReceived = {
  gateway: 'Kuickpay', received: '6500.00', coverage: 'FULL',
  label: 'PKR 6,500 received via Kuickpay (paid in full)', reference_text: 'Ref 550727',
  payments: [{ reference: '550727', receipt: '00000000000000000226', date: '2026-01-12', amount: '6500.00' }],
};
const several: KuickpayReceived = {
  gateway: 'Kuickpay', received: '2000.00', coverage: 'PARTIAL',
  label: 'PKR 2,000 received via Kuickpay (partial payment)', reference_text: 'Refs 600001, 600002',
  payments: [
    { reference: '600001', receipt: '00000000000000000301', date: '2026-01-10', amount: '1200.00' },
    { reference: '600002', receipt: '00000000000000000302', date: '2026-01-11', amount: '800.00' },
  ],
};

describe('kuickpayNote', () => {
  it('is null when nothing was received through Kuickpay', () => {
    expect(kuickpayNote({})).toBeNull();
    expect(kuickpayNote({ kuickpay: null })).toBeNull();
  });

  it('shows the server wording, the reference and the day for a single full payment', () => {
    expect(kuickpayNote({ kuickpay: single })).toEqual({
      label: 'PKR 6,500 received via Kuickpay (paid in full)',
      reference: 'Ref 550727  ·  12 Jan 2026',
      tone: 'success',
    });
  });

  it('marks a partial payment differently and lists every reference', () => {
    expect(kuickpayNote({ kuickpay: several })).toEqual({
      label: 'PKR 2,000 received via Kuickpay (partial payment)',
      reference: 'Refs 600001, 600002',
      tone: 'info',
    });
  });

  it('never shifts the day with the device time zone', () => {
    const edge = { ...single, payments: [{ ...single.payments[0], date: '2026-03-01' }] };
    expect(kuickpayNote({ kuickpay: edge })?.reference).toContain('1 Mar 2026');
  });
});
