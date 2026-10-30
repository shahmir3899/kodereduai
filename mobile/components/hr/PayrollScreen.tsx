import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { hrApi } from '../../services/api';
import { usePayrollActions, usePayrollSummary, usePayslipsPaged } from '../../hooks/usePayroll';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import { monthLabel, stepMonth } from '../../services/register';
import { payslipPeriod, payslipTone } from '../../services/accountant';
import {
  breakdownLines, generationText, payslipActions, payslipFileName, STATUS_FILTERS, summaryLine, type PayslipFull,
} from '../../services/payroll';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import { inventoryErrorMessage } from '../../services/inventory';
import { formatMoney } from '../../services/feeCollect';
import SegmentedTabs from '../ui/SegmentedTabs';
import Button from '../ui/Button';
import DateField from '../ui/DateField';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of PayrollPage.jsx for admin and principal: a month's totals, the payslips, and
// generate, approve, mark paid, delete a draft, and the server's own payslip PDF.
export default function PayrollScreen() {
  const toast = useToast();
  const actions = usePayrollActions();
  const now = new Date();
  const current = { year: now.getFullYear(), month0: now.getMonth() };
  const [period, setPeriod] = useState(current);
  const month = period.month0 + 1;
  const [status, setStatus] = useState('');
  const summary = usePayrollSummary(month, period.year);
  const query = usePayslipsPaged(month, period.year, status);
  const refreshControl = useRefreshControl(summary.refetch, query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [open, setOpen] = useState<PayslipFull | null>(null);
  const [paidOn, setPaidOn] = useState(todayString());
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(inventoryErrorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    const ok = await confirm({
      title: `Generate payslips for ${monthLabel(period.year, period.month0)}?`,
      message: 'Creates a draft payslip for every active staff member who has none for this month. Existing payslips are left alone.',
      confirmLabel: 'Generate',
    });
    if (!ok) return;
    setBusy('generate');
    try {
      const res = await actions.generate.mutateAsync({ month, year: period.year });
      toast.success(generationText(res.status, res.data));
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not generate payslips.'));
    } finally {
      setBusy(null);
    }
  };

  const approve = async (p: PayslipFull) => {
    if (await run('approve', () => actions.approve.mutateAsync(p.id), 'Payslip approved.')) setOpen(null);
  };
  const markPaid = async (p: PayslipFull) => {
    const ok = await confirm({ title: 'Mark as paid?', message: `${p.staff_member_name}: ${formatMoney(Number(p.net_salary) || 0)} on ${paidOn}.`, confirmLabel: 'Mark paid' });
    if (!ok) return;
    if (await run('paid', () => actions.markPaid.mutateAsync({ id: p.id, data: { payment_date: paidOn } }), 'Marked as paid.')) setOpen(null);
  };
  const remove = async (p: PayslipFull) => {
    const ok = await confirm({ title: 'Delete this draft?', message: `${p.staff_member_name}, ${payslipPeriod(p)}`, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    if (await run('delete', () => actions.remove.mutateAsync(p.id), 'Draft deleted.')) setOpen(null);
  };
  const pdf = async (p: PayslipFull) => {
    setBusy('pdf');
    try {
      await shareReportFile(() => hrApi.downloadPayslipPdf(p.id), payslipFileName(p, p.staff_member_name), 'pdf');
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = summary.data;
  const header = (
    <View>
      <View style={styles.monthRow}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" style={styles.step} onPress={() => setPeriod((p) => stepMonth(p.year, p.month0, -1, current))}><Text style={styles.stepText}>‹</Text></TouchableOpacity>
        <Text style={styles.month}>{monthLabel(period.year, period.month0)}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" style={styles.step} onPress={() => setPeriod((p) => stepMonth(p.year, p.month0, 1, current))}><Text style={styles.stepText}>›</Text></TouchableOpacity>
      </View>
      {s ? (
        <Card>
          <Text style={styles.totalLabel}>Net payroll</Text>
          <Text style={styles.totalValue}>{formatMoney(Number(s.total_net) || 0)}</Text>
          <Text style={styles.sub}>Basic {formatMoney(Number(s.total_basic) || 0)} · Allowances {formatMoney(Number(s.total_allowances) || 0)} · Deductions {formatMoney(Number(s.total_deductions) || 0)}</Text>
          <Text style={styles.sub}>{summaryLine(s)}</Text>
        </Card>
      ) : null}
      <View style={styles.gap} />
      <Button title="Generate payslips" size="sm" onPress={generate} loading={busy === 'generate'} disabled={busy !== null} />
      <View style={styles.gap} />
      <SegmentedTabs tabs={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))} value={status as '' | 'DRAFT' | 'APPROVED' | 'PAID'} onChange={setStatus} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const actionsFor = open ? payslipActions(open.status) : null;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(p) => String(p.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No payslips" message="Generate payslips for this month, or pick another month." />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: p }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => { setOpen(p); setPaidOn(todayString()); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{p.staff_member_name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[p.staff_employee_id, p.department_name].filter(Boolean).join('  ·  ') || ' '}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.net}>{formatMoney(Number(p.net_salary) || 0)}</Text>
              <StatusPill label={p.status_display ?? p.status} tone={payslipTone(p.status)} />
            </View>
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={open !== null} title={open ? `${open.staff_member_name}` : ''} onClose={() => setOpen(null)} onSubmit={() => setOpen(null)} submitLabel="Close">
        {open ? (
          <View style={styles.detail}>
            <Text style={styles.sub}>{payslipPeriod(open)} · {open.status_display ?? open.status}</Text>
            <Line label="Basic salary" value={Number(open.basic_salary) || 0} />
            {breakdownLines(open.allowances_breakdown).map((l) => <Line key={`a-${l.label}`} label={`+ ${l.label}`} value={l.amount} />)}
            {breakdownLines(open.deductions_breakdown).map((l) => <Line key={`d-${l.label}`} label={`− ${l.label}`} value={l.amount} />)}
            <Line label="Net pay" value={Number(open.net_salary) || 0} bold />
            {open.working_days ? <Text style={styles.sub}>Present {open.present_days ?? 0} of {open.working_days} working days</Text> : null}
            {open.payment_date ? <Text style={styles.sub}>Paid on {open.payment_date}</Text> : null}
            {actionsFor?.markPaid ? <DateField label="Payment date" value={paidOn} onChange={setPaidOn} /> : null}
            <View style={styles.buttons}>
              {actionsFor?.approve ? <Button title="Approve" onPress={() => approve(open)} loading={busy === 'approve'} disabled={busy !== null} /> : null}
              {actionsFor?.markPaid ? <Button title="Mark as paid" variant="secondary" onPress={() => markPaid(open)} loading={busy === 'paid'} disabled={busy !== null} /> : null}
              <Button title="Share payslip PDF" variant="outline" onPress={() => pdf(open)} loading={busy === 'pdf'} disabled={busy !== null} />
              {actionsFor?.remove ? <Button title="Delete draft" variant="danger" onPress={() => remove(open)} loading={busy === 'delete'} disabled={busy !== null} /> : null}
            </View>
          </View>
        ) : null}
      </FormSheet>
    </View>
  );
}

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.bold]}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  step: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: FontSize.xxl, color: Colors.primary },
  month: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  totalLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  totalValue: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.primary },
  gap: { height: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  net: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  detail: { gap: Spacing.xs },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  lineLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  lineValue: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700', color: Colors.text },
  buttons: { gap: Spacing.sm, marginTop: Spacing.md },
});
