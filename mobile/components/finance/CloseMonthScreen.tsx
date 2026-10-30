import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet } from 'react-native';
import { useClosings, useCloseMonth } from '../../hooks/useAccountsAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  closeFailureText, defaultCloseMonth, lastClosing, MONTH_NAMES, monthLabel, validateClose,
} from '../../services/accountsAdmin';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Closing a month snapshots every account balance and locks that month: no payment, expense, income
// or transfer can be added or edited in it afterwards. Admin and principal only (not accountants).
// There is no reopen on the server, so the screen asks twice and only offers finished, open months.
export default function CloseMonthScreen() {
  const toast = useToast();
  const today = todayString();
  const start = defaultCloseMonth(today);
  const q = useClosings();
  const close = useCloseMonth();
  const refreshControl = useRefreshControl(q.refetch);
  const [year, setYear] = useState(String(start.year));
  const [month, setMonth] = useState(start.month);
  const [notes, setNotes] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const last = lastClosing(q.data ?? []);
  const reset = () => { setUnderstood(false); setError(null); };

  const submit = async () => {
    const y = Number(year);
    const problem = validateClose(y, month, today, q.data ?? []);
    if (problem) return setError(problem);
    setError(null);
    const label = monthLabel(y, month);
    if (!(await confirm({
      title: `Close ${label}?`,
      message: 'Balances are saved as of its last day and the month is locked. Nothing in it can be added or edited afterwards.',
      confirmLabel: 'Close month', destructive: true,
    }))) return;
    try {
      await close.mutateAsync({ year: y, month, notes: notes.trim() || undefined });
      toast.success(`${label} closed.`);
      setUnderstood(false);
      setNotes('');
    } catch (e) {
      setError(closeFailureText(e));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <QueryBoundary query={q} isEmpty={() => false}>
        {(closings) => (
          <>
            <Card style={styles.card}>
              <Text style={styles.title}>Close a month</Text>
              <Text style={styles.hint}>{last ? `Last closed: ${monthLabel(last.year, last.month)}` : 'No month has been closed yet.'}</Text>
              <Select label="Month" value={month} onChange={(v) => { setMonth(Number(v)); reset(); }} options={MONTH_NAMES.map((n, i) => ({ value: i + 1, label: n }))} />
              <Input label="Year" value={year} onChangeText={(v) => { setYear(v.replace(/\D/g, '').slice(0, 4)); reset(); }} keyboardType="number-pad" />
              <Input label="Note (optional)" value={notes} onChangeText={setNotes} />
              <View style={styles.warn}>
                <Text style={styles.warnText}>{`This locks ${monthLabel(Number(year) || 0, month)}. No payments, expenses, income or transfers can be added or edited in it afterwards.`}</Text>
                <View style={styles.toggle}>
                  <Text style={styles.toggleLabel}>I understand, close this month</Text>
                  <Switch value={understood} onValueChange={setUnderstood} accessibilityLabel="I understand, close this month" />
                </View>
              </View>
              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
              <Button title="Close month" variant="danger" onPress={submit} loading={close.isPending} disabled={!understood || close.isPending} />
            </Card>

            {closings.length > 0 ? <Text style={styles.section}>Closed months</Text> : null}
            {[...closings].sort((a, b) => b.year - a.year || b.month - a.month).map((c) => (
              <View key={c.id} style={styles.row}>
                <View style={styles.who}>
                  <Text style={styles.name}>{monthLabel(c.year, c.month)}</Text>
                  <Text style={styles.hint}>{[c.closed_by_name ? `by ${c.closed_by_name}` : null, c.closed_at?.slice(0, 10)].filter(Boolean).join('  ·  ')}</Text>
                </View>
                <StatusPill label="Closed" tone="neutral" />
              </View>
            ))}
          </>
        )}
      </QueryBoundary>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.md },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { backgroundColor: Colors.errorLight, borderRadius: 8, padding: Spacing.md, gap: Spacing.sm },
  warnText: { color: Colors.errorText, fontSize: FontSize.sm, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: Spacing.md },
  toggleLabel: { color: Colors.errorText, fontSize: FontSize.sm, flex: 1 },
  error: { color: Colors.error, fontSize: FontSize.sm },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 8, padding: Spacing.md, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
