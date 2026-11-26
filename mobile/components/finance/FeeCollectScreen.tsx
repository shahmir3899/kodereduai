import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import {
  MONTH_NAMES, PAYMENT_METHODS, STATUS_TABS, balanceOf, bulkDeleteFeesResultText, bulkDeleteFeesText, bulkPayPayload, bulkPayResultText, bulkPayText, bulkPayTotal, deletableIds, payableIds, skippedNote, validateBulkPay, buildPaymentPatch, canDeleteFee, canRecordPayment, categoryOptions, emptyPaymentForm,
  feeDescription, feeLabel, filterPayments, formatMoney, sortPayments, statusTone, stepFeeMonth, summarize, validatePayment,
  type FeePayment, type FeeTypeTab, type PaymentForm, type StatusTab, groupByStudent, groupStatus, shouldGroupByStudent } from '../../services/feeCollect';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useAccounts, useBulkDeleteFees, useBulkPayFull, useDeleteFeePayment, useFeePayments, useRecordPayment } from '../../hooks/useFees';
import { selectedAll, toggleAll, toggleId } from '../../services/questionExtras';
import { confirm } from '../ui/confirm';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { reportsApi } from '../../services/api';
import { voucherParams } from '../../services/feeVouchers';
import { shareReportFile } from '../../services/reportShare';
import { feeReportFileName, feeReportRequest } from '../../services/reports';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import FormSheet from '../inventory/FormSheet';
import VoucherSheet from './VoucherSheet';
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
import KuickpayReceivedLabel from './KuickpayReceivedLabel';
import CopyableNumber from '../ui/CopyableNumber';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius, GlyphSize } from '../../constants/colors';
import AppList from '../ui/AppList';
import RecordCard from '../ui/RecordCard';

interface Props {
  // Teachers pass their own sections (and must pick one); admins leave it out and may see all.
  classOptions?: ClassOption[];
  // Read-only roles (finance) see the list but can't record.
  canRecord?: boolean;
  // Admin and principal: delete an unpaid record, and share the month's fee collection report.
  canManage?: boolean;
}

const ALL_CATEGORIES = '__all';

// Record fee payments: pick a month and class, tap a student's fee, enter what was received.
// Needs a connection; the server decides what each role may see and change.
export default function FeeCollectScreen({ classOptions, canRecord = true, canManage = false }: Props) {
  const toast = useToast();
  const { options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const isTeacherScope = !!classOptions;

  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [ym, setYm] = useState(current);
  const [feeType, setFeeType] = useState<FeeTypeTab>('MONTHLY');
  const [status, setStatus] = useState<StatusTab>('ALL');
  const [classId, setClassId] = useState<number | null>(null);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [deleting, setDeleting] = useState<FeePayment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
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
  const remove = useDeleteFeePayment();
  const bulkPay = useBulkPayFull();
  const bulkDelete = useBulkDeleteFees();
  const academicYear = useAcademicYear({ lockToCurrent: true });
  const refreshControl = useRefreshControl(query.refetch, accounts.refetch);
  const today = todayString();

  const shown = useMemo(() => sortPayments(filterPayments(query.data ?? [], {
    masterClassId: option ? (option.classObj ?? option.id) : null,
    sessionClassId: option?.isSession ? option.id : null,
    status: status === 'ALL' ? '' : status,
    category: category === ALL_CATEGORIES ? '' : category,
    search,
  })), [query.data, option, status, category, search]);
  const categories = useMemo(() => categoryOptions(query.data ?? []), [query.data]);
  const totals = useMemo(() => summarize(shown), [shown]);
  // Several fee types this period (e.g. Tuition + Koder Kids): one card per student, each fee inside
  // it. Selecting for bulk actions works per record, so it shows the plain list meanwhile.
  const groups = useMemo(() => groupByStudent(shown), [shown]);
  const activeAccounts = (accounts.data ?? []).filter((a) => a.is_active !== false);

  // Bulk actions (admin and principal). Choosing is page-scoped: ids from a list no longer on screen must not ride along.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkPaying, setBulkPaying] = useState(false);
  const [bulkAccount, setBulkAccount] = useState<number | null>(null);
  const [bulkMethod, setBulkMethod] = useState<string>('CASH');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const listKey = `${feeType}|${ym.month}|${ym.year}|${effectiveClassId}|${status}|${category}|${search}`;
  React.useEffect(() => { setSelected([]); }, [listKey]);
  const shownIds = shown.map((p) => p.id);
  const payIds = payableIds(shown, selected);
  const delIds = deletableIds(shown, selected);

  const openBulkPay = () => {
    setBulkAccount(activeAccounts.length === 1 ? activeAccounts[0].id : null);
    setBulkMethod('CASH');
    setBulkError(null);
    setBulkPaying(true);
  };

  const confirmBulkPay = async () => {
    const problem = validateBulkPay(bulkAccount, payIds);
    if (problem) return setBulkError(problem);
    const account = activeAccounts.find((a) => a.id === bulkAccount);
    const method = PAYMENT_METHODS.find((m) => m.value === bulkMethod)?.label ?? bulkMethod;
    const ok = await confirm({
      title: 'Mark as fully paid?',
      message: bulkPayText(payIds.length, bulkPayTotal(shown, payIds), account?.name ?? 'the account', method) + skippedNote(selected.length, payIds.length),
      confirmLabel: 'Mark as paid',
    });
    if (!ok) return;
    try {
      const res = await bulkPay.mutateAsync(bulkPayPayload(payIds, bulkAccount as number, bulkMethod));
      toast.success(bulkPayResultText(res.data));
      setBulkPaying(false);
      setSelected([]);
      setSelecting(false);
    } catch (e) { setBulkError(staffLeaveErrorMessage(e, 'Could not record the payments.')); }
  };

  const removeSelected = async () => {
    if (delIds.length === 0) return;
    const ok = await confirm({ title: 'Delete selected fee records?', message: bulkDeleteFeesText(delIds.length) + skippedNote(selected.length, delIds.length), confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      const res = await bulkDelete.mutateAsync(delIds);
      toast.success(bulkDeleteFeesResultText(res.data));
      setSelected([]);
      setSelecting(false);
    } catch (e) { toast.error(staffLeaveErrorMessage(e, 'Could not delete the fee records.')); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleting.id);
      toast.success('Fee record deleted.');
      setDeleting(null);
    } catch (e) { setDeleteError(staffLeaveErrorMessage(e, 'Could not delete the fee record.')); }
  };

  // The server's fee collection report covers the whole school for the month shown.
  const shareMonthReport = async () => {
    setReporting(true);
    try {
      await shareReportFile(() => reportsApi.generateInstant(feeReportRequest('FEE_COLLECTION', ym.month, ym.year, academicYear.current?.id)) as Promise<{ data: ArrayBuffer }>,
        feeReportFileName('FEE_COLLECTION', ym.month, ym.year), 'pdf');
    } catch (e) { toast.error((e as Error)?.message || 'Could not make the report.'); }
    finally { setReporting(false); }
  };

  // Vouchers for the month: the chosen rows, else what is on screen. The sheet picks the due date,
  // previews and shares the PDF.
  const [voucherParamsOpen, setVoucherParamsOpen] = useState<Record<string, string | number> | null>(null);
  const openVouchers = () => setVoucherParamsOpen(voucherParams({
    month: ym.month, year: ym.year, shown, selectedIds: selecting ? selected : [],
    filtered: !!search || status !== 'ALL' || category !== ALL_CATEGORIES,
    option: option ?? null, academicYearId: academicYear.current?.id,
  }));

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
      <SegmentedTabs<StatusTab> value={status} onChange={setStatus} tabs={STATUS_TABS} scrollable />
      {categories.length > 1 ? (
        <Select label="Category" value={category} onChange={(v) => setCategory(String(v))}
          options={[{ value: ALL_CATEGORIES, label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]} />
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or roll number..." />
      {canManage ? (
        <View style={styles.bulkRow}>
          <Button title={selecting ? 'Done selecting' : 'Select'} size="sm" variant="outline" onPress={() => { setSelecting((v) => !v); setSelected([]); }} />
          {selecting ? <Button title={selectedAll(shownIds, selected) ? 'Clear page' : 'Select page'} size="sm" variant="ghost" onPress={() => setSelected((s) => toggleAll(shownIds, s))} /> : null}
        </View>
      ) : null}
      {canManage && selecting ? (
        <View style={styles.bulkRow}>
          <Button title={`Pay in full (${payIds.length})`} size="sm" variant="outline" disabled={payIds.length === 0 || bulkPay.isPending || bulkDelete.isPending} onPress={openBulkPay} />
          <Button title={`Delete (${delIds.length})`} size="sm" variant="danger" disabled={delIds.length === 0 || bulkPay.isPending || bulkDelete.isPending} onPress={removeSelected} />
        </View>
      ) : null}
      {feeType !== 'ANNUAL' && shown.length > 0 ? (
        <Button title={selecting && selected.length ? `Vouchers for ${selected.length} selected (PDF)` : `${MONTH_NAMES[ym.month - 1]} vouchers (PDF)`}
          size="sm" variant="outline" onPress={openVouchers} style={styles.reportBtn} />
      ) : null}
      {canManage && feeType !== 'ANNUAL' ? (
        <Button title={`${MONTH_NAMES[ym.month - 1]} report (PDF, whole school)`} size="sm" variant="outline" onPress={shareMonthReport} loading={reporting} disabled={reporting} style={styles.reportBtn} />
      ) : null}
      {shown.length > 0 ? (
        <View style={styles.totals}>
          <Total label="Due" value={formatMoney(totals.due)} color={Colors.text} />
          <Total label="Received" value={formatMoney(totals.paid)} color={Colors.success} />
          <Total label="Pending" value={formatMoney(totals.pending)} color={Colors.error} />
        </View>
      ) : null}
    </View>
  );

  const grouped = !selecting && shouldGroupByStudent(shown);

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState message={(query.error as any)?.response?.data?.detail} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      {grouped ? (
        <AppList
          data={groups}
          keyExtractor={(g) => g.key}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          ListHeaderComponent={header}
          renderItem={({ item: g }) => {
            const status = groupStatus(g);
            return (
              <RecordCard
                avatarName={g.student_name}
                title={g.student_name}
                subtitle={`${g.student_roll ? `Roll ${g.student_roll}  ·  ` : ''}${g.class_label}` || undefined}
                meta={`${g.rows.length} fee${g.rows.length === 1 ? '' : 's'}`}
                status={status === 'MIXED' ? { label: 'MIXED', tone: 'warning' } : { label: status, tone: statusTone(status) }}
                footer={<>
                  {g.rows.map((p) => {
                    const balance = balanceOf(p);
                    return (
                      <View key={p.id} style={styles.feeBlock}>
                        <Text style={styles.feeName}>{feeLabel(p)}</Text>
                        <View style={styles.amounts}>
                          <Amount label="Due" value={formatMoney(Number(p.amount_due))} />
                          <Amount label="Received" value={formatMoney(Number(p.amount_paid))} color={Colors.success} />
                          <Amount label="Balance" value={formatMoney(balance)} color={balance > 0 ? Colors.error : Colors.textSecondary} />
                        </View>
                        <KuickpayReceivedLabel kuickpay={p.kuickpay} />
                        {Number(p.previous_balance) > 0 ? <Text style={styles.carry}>Includes {formatMoney(Number(p.previous_balance))} carried forward</Text> : null}
                        <View style={styles.feeActions}>
                          {canManage && canDeleteFee(p) ? (
                            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete fee: ${feeDescription(p)}`} style={[styles.delete, styles.feeAction]} onPress={() => { setDeleteError(null); setDeleting(p); }}>
                              <Text style={styles.deleteText}>Delete</Text>
                            </TouchableOpacity>
                          ) : null}
                          {canRecord && canRecordPayment(p) ? (
                            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Record payment: ${feeLabel(p)}`} style={[styles.record, styles.feeAction]} onPress={() => open(p)}>
                              <Text style={styles.recordText}>Record payment</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                  {g.rows.length > 1 ? (
                    <View style={styles.subTotal}>
                      <Text style={styles.subTotalLabel}>Sub total</Text>
                      <View style={styles.amounts}>
                        <Amount label="Due" value={formatMoney(g.due)} />
                        <Amount label="Received" value={formatMoney(g.paid)} color={Colors.success} />
                        <Amount label="Balance" value={formatMoney(g.balance)} color={g.balance > 0 ? Colors.error : Colors.textSecondary} />
                      </View>
                    </View>
                  ) : null}
                </>}
              />
            );
          }}
        />
      ) : (
      <AppList
        data={shown}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No fees" message="No fee records match. Fees can be generated from Generate Fee Records." />}
        renderItem={({ item: p }) => {
          const balance = balanceOf(p);
          const toggle = () => setSelected((s) => toggleId(s, p.id));
          return (
            <RecordCard
              avatarName={p.student_name}
              title={p.student_name}
              subtitle={`${p.student_roll ? `Roll ${p.student_roll}  ·  ` : ''}${p.session_class_label || p.class_name || ''}` || undefined}
              meta={feeLabel(p)}
              status={{ label: p.status, tone: statusTone(p.status) }}
              selected={selecting ? selected.includes(p.id) : undefined}
              onPress={selecting ? toggle : undefined}
              onSelect={selecting ? toggle : undefined}
              footer={<>
                <View style={styles.amounts}>
                  <Amount label="Due" value={formatMoney(Number(p.amount_due))} />
                  <Amount label="Received" value={formatMoney(Number(p.amount_paid))} color={Colors.success} />
                  <Amount label="Balance" value={formatMoney(balance)} color={balance > 0 ? Colors.error : Colors.textSecondary} />
                </View>
                <KuickpayReceivedLabel kuickpay={p.kuickpay} />
                {p.kuickpay_consumer_number ? (
                  <View style={styles.consumerRow}>
                    <Text style={styles.consumerLabel}>Kuickpay No.</Text>
                    <CopyableNumber value={p.kuickpay_consumer_number} textStyle={styles.consumerNumber} />
                  </View>
                ) : null}
                {Number(p.previous_balance) > 0 ? <Text style={styles.carry}>Includes {formatMoney(Number(p.previous_balance))} carried forward</Text> : null}
                {!selecting && canManage && canDeleteFee(p) ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete fee: ${feeDescription(p)}`} style={styles.delete} onPress={() => { setDeleteError(null); setDeleting(p); }}>
                    <Text style={styles.deleteText}>Delete this record</Text>
                  </TouchableOpacity>
                ) : null}
                {!selecting && canRecord && canRecordPayment(p) ? (
                  <TouchableOpacity accessibilityRole="button" style={styles.record} onPress={() => open(p)}>
                    <Text style={styles.recordText}>Record payment</Text>
                  </TouchableOpacity>
                ) : null}
              </>}
            />
          );
        }}
      />
      )}

      <VoucherSheet visible={voucherParamsOpen !== null} onClose={() => setVoucherParamsOpen(null)}
        month={ym.month} year={ym.year} params={voucherParamsOpen ?? {}} />

      <FormSheet visible={deleting !== null} title="Delete this fee record?" onClose={() => setDeleting(null)} onSubmit={confirmDelete} submitLabel="Delete" busy={remove.isPending} error={deleteError}>
        {deleting ? <Text style={styles.sheetWho}>{feeDescription(deleting)}</Text> : null}
        <Text style={styles.sheetSub}>Nothing has been paid on it. Deleting it cannot be undone.</Text>
      </FormSheet>

      <FormSheet visible={bulkPaying} title="Mark selected as fully paid" onClose={() => setBulkPaying(false)} onSubmit={confirmBulkPay} submitLabel="Continue" busy={bulkPay.isPending} error={bulkError}>
        <Text style={styles.sheetSub}>{payIds.length} fee record{payIds.length === 1 ? '' : 's'}, {formatMoney(bulkPayTotal(shown, payIds))} still owing.{skippedNote(selected.length, payIds.length)} Each is paid for its full balance, dated today.</Text>
        <Select label="Account *" value={bulkAccount} options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => { setBulkAccount(v); setBulkError(null); }}
          placeholder={accounts.isLoading ? 'Loading...' : 'Select account'} />
        <Select label="Method" value={bulkMethod} options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => setBulkMethod(String(v))} />
      </FormSheet>

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
  step: { fontSize: GlyphSize.lg, color: Colors.primary, paddingHorizontal: Spacing.sm },
  stepOff: { color: Colors.border },
  month: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, minWidth: 150, textAlign: 'center' },
  totals: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  total: { flex: 1, alignItems: 'center' },
  totalValue: { fontSize: FontSize.md, fontWeight: '700' },
  totalLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  amounts: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  amount: { flex: 1 },
  amountLabel: { fontSize: FontSize.xxs, color: Colors.textSecondary },
  amountValue: { fontSize: FontSize.sm, fontWeight: '700' },
  reportBtn: { alignSelf: 'flex-start', marginBottom: Spacing.md },
  bulkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  delete: { marginTop: Spacing.sm, borderWidth: 1, borderColor: Colors.error, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  deleteText: { color: Colors.error, fontWeight: '700', fontSize: FontSize.sm },
  carry: { fontSize: FontSize.xs, color: Colors.warning, marginTop: Spacing.xs },
  feeBlock: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.sm },
  feeName: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  feeActions: { flexDirection: 'row', gap: Spacing.sm },
  feeAction: { flex: 1 },
  subTotal: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.sm },
  subTotalLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  consumerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  consumerLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  consumerNumber: { fontSize: FontSize.sm },
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
