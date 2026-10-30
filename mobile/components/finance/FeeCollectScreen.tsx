import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import {
  MONTH_NAMES, PAYMENT_METHODS, balanceOf, buildPaymentPatch, canRecordPayment, emptyPaymentForm, feeLabel,
  filterPayments, formatMoney, sortPayments, statusTone, stepFeeMonth, summarize, validatePayment,
  type FeePayment, type FeeTypeTab, type PaymentForm,
} from '../../services/feeCollect';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useAccounts, useFeePayments, useRecordPayment } from '../../hooks/useFees';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import SearchBar from '../ui/SearchBar';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Teachers pass their own sections (and must pick one); admins leave it out and may see all.
  classOptions?: ClassOption[];
  // Read-only roles (accountant) see the list but can't record.
  canRecord?: boolean;
}

type StatusTab = 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID';

// Record fee payments: pick a month and class, tap a student's fee, enter what was received.
// Needs a connection; the server decides what each role may see and change.
export default function FeeCollectScreen({ classOptions, canRecord = true }: Props) {
  const toast = useToast();
  const { options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const isTeacherScope = !!classOptions;

  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [ym, setYm] = useState(current);
  const [feeType, setFeeType] = useState<FeeTypeTab>('MONTHLY');
  const [status, setStatus] = useState<StatusTab>('ALL');
  const [classId, setClassId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState<FeePayment | null>(null);
  const [form, setForm] = useState<PaymentForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A teacher always works inside one of their sections, so the first is pre-selected.
  const effectiveClassId = classId ?? (isTeacherScope ? options[0]?.id ?? null : null);
  const option = options.find((o) => o.id === effectiveClassId) ?? null;

  const query = useFeePayments(feeType, ym.month, ym.year);
  const accounts = useAccounts();
  const record = useRecordPayment();
  const refreshControl = useRefreshControl(query.refetch, accounts.refetch);
  const today = todayString();

  const shown = useMemo(() => sortPayments(filterPayments(query.data ?? [], {
    masterClassId: option ? (option.classObj ?? option.id) : null,
    sessionClassId: option?.isSession ? option.id : null,
    status: status === 'ALL' ? '' : status,
    search,
  })), [query.data, option, status, search]);
  const totals = useMemo(() => summarize(shown), [shown]);
  const activeAccounts = (accounts.data ?? []).filter((a) => a.is_active !== false);

  const open = (p: FeePayment) => {
    setPaying(p);
    setForm(emptyPaymentForm(balanceOf(p), today, activeAccounts.length === 1 ? activeAccounts[0].id : (p.account ?? null)));
    setError(null);
  };

  const save = async () => {
    if (!paying || !form) return;
    const problem = validatePayment(form, balanceOf(paying), today);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await record.mutateAsync({ id: paying.id, data: buildPaymentPatch(paying, form) });
      toast.success(`Recorded ${formatMoney(Number(form.amount))} from ${paying.student_name}.`);
      setPaying(null);
    } catch (e: any) {
      if (!e?.response) setError('No connection. Check your internet and try again.');
      else {
        const d = e.response?.data;
        setError(d?.detail || d?.account?.[0] || d?.amount_paid?.[0] || 'Failed to record payment');
      }
    }
  };

  if (classesLoading) return <Skeleton />;

  const header = (
    <View>
      <View style={styles.stepper}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} disabled={feeType === 'ANNUAL'} onPress={() => setYm(stepFeeMonth(ym.year, ym.month, -1, current))}>
          <Text style={[styles.step, feeType === 'ANNUAL' && styles.stepOff]}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.month}>{feeType === 'ANNUAL' ? `Annual ${ym.year}` : `${MONTH_NAMES[ym.month - 1]} ${ym.year}`}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} disabled={feeType === 'ANNUAL' || (ym.year === current.year && ym.month === current.month)}
          onPress={() => setYm(stepFeeMonth(ym.year, ym.month, 1, current))}>
          <Text style={[styles.step, (feeType === 'ANNUAL' || (ym.year === current.year && ym.month === current.month)) && styles.stepOff]}>›</Text>
        </TouchableOpacity>
      </View>
      <SegmentedTabs<FeeTypeTab> value={feeType} onChange={setFeeType}
        tabs={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }, { value: 'ALL', label: 'All types' }]} />
      <Select label="Class" value={effectiveClassId} options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={setClassId} placeholder={isTeacherScope ? 'Select a class' : 'All classes'} />
      <SegmentedTabs<StatusTab> value={status} onChange={setStatus}
        tabs={[{ value: 'ALL', label: 'All' }, { value: 'UNPAID', label: 'Unpaid' }, { value: 'PARTIAL', label: 'Partial' }, { value: 'PAID', label: 'Paid' }]} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or roll number..." />
      {shown.length > 0 ? (
        <View style={styles.totals}>
          <Total label="Due" value={formatMoney(totals.due)} color={Colors.text} />
          <Total label="Received" value={formatMoney(totals.paid)} color={Colors.success} />
          <Total label="Pending" value={formatMoney(totals.pending)} color={Colors.error} />
        </View>
      ) : null}
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState message={(query.error as any)?.response?.data?.detail} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={shown}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No fees" message="No fee records match. Fees are generated on the web app." />}
        renderItem={({ item: p }) => {
          const balance = balanceOf(p);
          return (
            <View style={styles.card}>
              <View style={styles.top}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.student_name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {p.student_roll ? `Roll ${p.student_roll}  ·  ` : ''}{p.session_class_label || p.class_name || ''}
                  </Text>
                </View>
                <StatusPill label={p.status} tone={statusTone(p.status)} />
              </View>
              <Text style={styles.fee}>{feeLabel(p)}</Text>
              <View style={styles.amounts}>
                <Amount label="Due" value={formatMoney(Number(p.amount_due))} />
                <Amount label="Received" value={formatMoney(Number(p.amount_paid))} color={Colors.success} />
                <Amount label="Balance" value={formatMoney(balance)} color={balance > 0 ? Colors.error : Colors.textSecondary} />
              </View>
              {Number(p.previous_balance) > 0 ? <Text style={styles.carry}>Includes {formatMoney(Number(p.previous_balance))} carried forward</Text> : null}
              {canRecord && canRecordPayment(p) ? (
                <TouchableOpacity accessibilityRole="button" style={styles.record} onPress={() => open(p)}>
                  <Text style={styles.recordText}>Record payment</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }}
      />

      <BottomSheet visible={!!paying && !!form} onClose={() => setPaying(null)} title="Record payment">
        {paying && form ? (
          <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetWho}>{paying.student_name}  ·  {feeLabel(paying)}</Text>
            <Text style={styles.sheetSub}>
              Payable {formatMoney(Number(paying.amount_due))}  ·  Already received {formatMoney(Number(paying.amount_paid))}  ·  Balance {formatMoney(balanceOf(paying))}
            </Text>

            <Text style={styles.label}>Amount received now</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={form.amount} selectTextOnFocus
              onChangeText={(t) => { setForm({ ...form, amount: t.replace(',', '.') }); setError(null); }} />
            <Select label="Method" value={form.method} options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
              onChange={(v) => setForm({ ...form, method: v })} />
            <Select label="Account *" value={form.account} options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(v) => { setForm({ ...form, account: v }); setError(null); }} placeholder={accounts.isLoading ? 'Loading...' : 'Select account'} />
            <DateField label="Date *" value={form.date} onChange={(v) => setForm({ ...form, date: v })} maximumDate={new Date()} />
            <Text style={styles.label}>Receipt # (optional)</Text>
            <TextInput style={styles.input} value={form.receipt} onChangeText={(t) => setForm({ ...form, receipt: t })} />
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput style={[styles.input, styles.multi]} multiline value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Save payment" onPress={save} loading={record.isPending} fullWidth size="lg" />
          </ScrollView>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function Total({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.total}>
      <Text style={[styles.totalValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

function Amount({ label, value, color = Colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.amount}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={[styles.amountValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, marginBottom: Spacing.md },
  step: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.sm },
  stepOff: { color: Colors.border },
  month: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, minWidth: 150, textAlign: 'center' },
  totals: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  total: { flex: 1, alignItems: 'center' },
  totalValue: { fontSize: FontSize.md, fontWeight: '700' },
  totalLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  fee: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
  amounts: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  amount: { flex: 1 },
  amountLabel: { fontSize: 10, color: Colors.textSecondary },
  amountValue: { fontSize: FontSize.sm, fontWeight: '700' },
  carry: { fontSize: FontSize.xs, color: Colors.warning, marginTop: Spacing.xs },
  record: { marginTop: Spacing.sm, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  recordText: { color: Colors.textInverse, fontWeight: '700', fontSize: FontSize.sm },
  sheet: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  sheetWho: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sheetSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: FontSize.md, color: Colors.text, marginBottom: Spacing.lg,
  },
  multi: { minHeight: 70, textAlignVertical: 'top' },
  error: { fontSize: FontSize.sm, color: Colors.error, marginBottom: Spacing.md },
});
