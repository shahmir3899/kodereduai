import React, { useMemo, useState } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { hrApi } from '../../services/api';
import { payslipFileName } from '../../services/payroll';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';
import { useMyPayslips } from '../../hooks/useStaff';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { payslipPeriod, payslipTone, sortPayslips } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Own payslips, read-only. Salary figures are never cached to the phone (root 'payslips' is not
// in the persisted list).
export default function PayslipsScreen() {
  const q = useMyPayslips();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  // The server's own payslip PDF, the same file the web gives; the API only lets you fetch your own.
  const share = async (id: number, p: { month: number; year: number }) => {
    setBusy(id);
    try {
      await shareReportFile(() => hrApi.downloadPayslipPdf(id), payslipFileName(p, 'My'), 'pdf');
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const refreshControl = useRefreshControl(q.refetch);
  const rows = useMemo(() => sortPayslips(q.data ?? []), [q.data]);
  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(p) => String(p.id)}
      refreshControl={refreshControl}
      ListEmptyComponent={<EmptyState title="No payslips yet" message="Payslips appear here once payroll is run." />}
      renderItem={({ item: p }) => (
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.period}>{payslipPeriod(p)}</Text>
            <StatusPill label={p.status_display ?? p.status} tone={payslipTone(p.status)} />
          </View>
          <Line label="Basic salary" value={p.basic_salary} />
          <Line label="Allowances" value={p.total_allowances} />
          <Line label="Deductions" value={p.total_deductions} negative />
          <View style={styles.net}>
            <Text style={styles.netLabel}>Net pay</Text>
            <Text style={styles.netValue}>{formatMoney(Number(p.net_salary) || 0)}</Text>
          </View>
          {p.working_days ? <Text style={styles.foot}>Present {p.present_days ?? 0} of {p.working_days} working days</Text> : null}
          {p.payment_date ? <Text style={styles.foot}>Paid on {p.payment_date}</Text> : null}
          <Button title="Share PDF" size="sm" variant="outline" onPress={() => share(p.id, p)} loading={busy === p.id} disabled={busy !== null} />
        </View>
      )}
    />
  );
}

function Line({ label, value, negative }: { label: string; value?: number | string; negative?: boolean }) {
  const n = Number(value) || 0;
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{negative && n > 0 ? '-' : ''}{formatMoney(n)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  period: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  lineLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  lineValue: { fontSize: FontSize.sm, color: Colors.text },
  net: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, marginTop: Spacing.sm, paddingTop: Spacing.sm },
  netLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  netValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  foot: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },
});
