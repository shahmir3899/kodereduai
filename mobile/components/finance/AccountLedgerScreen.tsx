import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAccountLedger } from '../../hooks/useAccountant';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { ledgerTypeLabel } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import QueryBoundary from '../ui/QueryBoundary';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const money = (v: number | string | null | undefined) => formatMoney(Number(v ?? 0) || 0);

// One account's ledger, read only: opening and closing balance, credits and debits, and each
// entry with its running balance (the web Accounts page, Ledger tab). Latest 200 entries.
export default function AccountLedgerScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useAccountLedger(Number(id), from, to);
  const refreshControl = useRefreshControl(q.refetch);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      {name ? <Text style={styles.title}>{name}</Text> : null}
      <View style={styles.dates}>
        <View style={styles.half}><DateField label="From date" value={from} onChange={setFrom} /></View>
        <View style={styles.half}><DateField label="To date" value={to} onChange={setTo} /></View>
      </View>
      {from || to ? <Button title="Clear dates" size="sm" variant="ghost" onPress={() => { setFrom(''); setTo(''); }} /> : null}
      <QueryBoundary query={q} emptyTitle="No ledger" emptyMessage="Nothing to show for this account.">
        {(d) => (
          <>
            <View style={styles.tiles}>
              <Card style={styles.tile}><Text style={styles.label}>Opening</Text><Text style={styles.value}>{money(d.opening_balance)}</Text></Card>
              <Card style={styles.tile}><Text style={styles.label}>Closing</Text><Text style={styles.value}>{money(d.closing_balance)}</Text></Card>
            </View>
            <View style={styles.tiles}>
              <Card style={styles.tile}><Text style={styles.label}>Credits</Text><Text style={[styles.value, { color: Colors.success }]}>{money(d.total_credits)}</Text></Card>
              <Card style={styles.tile}><Text style={styles.label}>Debits</Text><Text style={[styles.value, { color: Colors.error }]}>{money(d.total_debits)}</Text></Card>
            </View>
            {d.entries.length === 0 ? <Text style={styles.muted}>No entries in this period.</Text> : d.entries.map((e) => {
              const credit = Number(e.credit) || 0;
              const debit = Number(e.debit) || 0;
              return (
                <View key={`${e.type}-${e.id}`} style={styles.row}>
                  <View style={styles.top}>
                    <StatusPill label={ledgerTypeLabel(e.type)} tone={debit > 0 ? 'error' : 'success'} />
                    <Text style={styles.date}>{e.date || 'Undated'}</Text>
                  </View>
                  <Text style={styles.desc} numberOfLines={2}>{e.description}</Text>
                  <View style={styles.top}>
                    <Text style={[styles.amount, { color: debit > 0 ? Colors.error : Colors.success }]}>{debit > 0 ? `-${money(debit)}` : `+${money(credit)}`}</Text>
                    <Text style={styles.running}>Balance {money(e.running_balance)}</Text>
                  </View>
                </View>
              );
            })}
            {d.entries.length >= 200 ? <Text style={styles.muted}>Showing the latest 200 entries. Narrow the dates to see others.</Text> : null}
          </>
        )}
      </QueryBoundary>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  dates: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, padding: Spacing.md },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary },
  value: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: 2 },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { fontSize: FontSize.xs, color: Colors.textSecondary },
  desc: { fontSize: FontSize.sm, color: Colors.text },
  amount: { fontSize: FontSize.md, fontWeight: '700' },
  running: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
