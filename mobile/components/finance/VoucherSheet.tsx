import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { financeApi } from '../../services/api';
import { todayString } from '../../services/attendanceEntry';
import { defaultDueDate, voucherFileName, type VoucherPreview } from '../../services/feeVouchers';
import { formatMoney } from '../../services/feeCollect';
import { shareReportFile } from '../../services/reportShare';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import FormSheet from '../inventory/FormSheet';
import DateField from '../ui/DateField';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Fee vouchers for the month: pick the due date (the school's due day, or a week from today once that
// has passed), preview the first vouchers, then share the A4 PDF. Same steps as the web dialog.
export default function VoucherSheet({ visible, onClose, month, year, params }: {
  visible: boolean;
  onClose: () => void;
  month: number;
  year: number;
  params: Record<string, string | number>;
}) {
  const toast = useToast();
  const today = todayString();
  const settings = useScopedQuery('voucherSettings', [], async () => (await financeApi.getVoucherSettings()).data as { due_day: number }, { enabled: visible });
  const due = useMemo(
    () => (settings.data ? defaultDueDate(year, month, settings.data.due_day, today) : null),
    [settings.data, year, month, today],
  );
  const [dueDate, setDueDate] = useState('');
  const [preview, setPreview] = useState<VoucherPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && due) setDueDate(due.date);
    if (!visible) { setPreview(null); setError(null); }
  }, [visible, due]);

  const withDue = () => ({ ...params, ...(dueDate ? { due_date: dueDate } : {}) });

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = (await financeApi.previewFeeVouchers(withDue())).data as VoucherPreview;
      if (!data.count) setError('Nobody in this list owes anything for this month.');
      setPreview(data);
    } catch {
      setError('Could not load the preview.');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      await shareReportFile(async () => {
        const res = await financeApi.downloadFeeVouchers(withDue());
        if (Number((res.headers as Record<string, string>)?.['x-voucher-count'] ?? -1) === 0) {
          throw new Error('Nobody in this list owes anything for this month.');
        }
        return res as { data: ArrayBuffer };
      }, voucherFileName(month, year), 'pdf');
      onClose();
    } catch (e) {
      setError((e as Error)?.message || 'Could not make the vouchers.');
      toast.error('Could not make the vouchers.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet visible={visible} title="Fee vouchers" onClose={onClose} onSubmit={share} submitLabel="Share PDF" busy={busy}
      error={error} secondaryLabel="Preview" onSecondary={loadPreview}>
      <Text style={styles.hint}>A4 paper, 3 students per page, a school copy and a student copy each. Totals include unpaid dues from earlier months.</Text>
      <DateField label="Due date on these vouchers" value={dueDate} onChange={(v) => { setDueDate(v); setPreview(null); }} />
      {due?.late ? (
        <Text style={styles.warn}>The school's due date for this month ({due.usual}) has passed, so these vouchers are due a week from today. Change it above if needed.</Text>
      ) : null}
      {preview && preview.count > 0 ? (
        <View>
          <Text style={styles.hint}>Preview: {preview.count} voucher{preview.count === 1 ? '' : 's'}. First ones shown.</Text>
          {preview.vouchers.slice(0, 2).map((v) => (
            <View key={v.student_id} style={styles.card} accessibilityLabel={`Voucher for ${v.student_name}`}>
              <Text style={styles.school}>{preview.school_name}</Text>
              <Text style={styles.who}>{v.student_name}  ·  {v.class_label}</Text>
              <Text style={styles.small}>Voucher {v.voucher_number}  ·  Due {v.due_date}</Text>
              {v.lines.map((l) => <Row key={l.label} label={l.label} value={formatMoney(Number(l.amount))} />)}
              {Number(v.discount) > 0 ? <Row label="Less: discount" value={`-${formatMoney(Number(v.discount))}`} /> : null}
              <Row label="Previous unpaid" value={formatMoney(Number(v.previous_unpaid))} />
              {Number(v.paid) > 0 ? <Row label="Less: already paid" value={`-${formatMoney(Number(v.paid))}`} /> : null}
              <Row label="Total payable" value={formatMoney(Number(v.total_payable))} bold />
              {preview.bank ? <Text style={styles.small}>Pay at bank: {preview.bank.bank_name}{preview.bank.account_number ? `, A/C ${preview.bank.account_number}` : ''}</Text> : null}
              {v.kuickpay_number ? <Text style={styles.small}>Kuickpay No. {v.kuickpay_number}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </FormSheet>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowText, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowText, bold && styles.bold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  warn: { fontSize: FontSize.sm, color: Colors.warning, backgroundColor: Colors.warningLight, padding: Spacing.sm, borderRadius: BorderRadius.sm, marginBottom: Spacing.sm },
  card: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.sm, backgroundColor: Colors.surface },
  school: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  who: { fontSize: FontSize.sm, color: Colors.text, marginTop: 2 },
  small: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  rowText: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700' },
});
