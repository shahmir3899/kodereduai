import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { entryAmount, entrySign, type RecentEntry } from '../../services/accountant';
import type { TransferRow } from '../../hooks/useAccountant';
import { entryBadge } from '../../services/financeDashboard';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The newest transfers between accounts, with a link to all of them.
export function RecentTransfersCard({ transfers, loading, onAll }: { transfers: TransferRow[] | undefined; loading?: boolean; onAll: () => void }) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Recent transfers</Text>
        <TouchableOpacity accessibilityRole="button" onPress={onAll} hitSlop={8}><Text style={styles.link}>View all</Text></TouchableOpacity>
      </View>
      {loading ? <Text style={styles.muted}>Loading…</Text> : (transfers ?? []).length === 0 ? <Text style={styles.muted}>No transfers recorded.</Text> : (
        (transfers ?? []).map((t) => (
          <View key={t.id} style={styles.line}>
            <View style={styles.body}>
              <Text style={styles.main} numberOfLines={1}>{t.from_account_name} → {t.to_account_name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{t.date}{t.description ? ` — ${t.description}` : ''}</Text>
            </View>
            <Text style={styles.amount}>{formatMoney(Number(t.amount) || 0)}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

// The latest fee payments, income, expenses and transfers with who recorded each. School admin only.
export function RecentEntriesCard({ entries }: { entries: RecentEntry[] | undefined }) {
  if (!entries || entries.length === 0) return null;
  return (
    <Card style={styles.card}>
      <Text style={[styles.title, { marginBottom: Spacing.sm }]}>Recent entries</Text>
      {entries.map((e) => {
        const badge = entryBadge(e);
        const sign = entrySign(e.type);
        return (
          <View key={`${e.type}-${e.id}`} style={styles.line}>
            <View style={styles.body}>
              <View style={styles.badgeRow}>
                <StatusPill label={badge.label} tone={badge.tone} />
                <Text style={styles.main} numberOfLines={1}>{e.description || 'Entry'}</Text>
              </View>
              <Text style={styles.sub} numberOfLines={1}>{[e.account_name, e.date, e.recorded_by ? `by ${e.recorded_by}` : ''].filter(Boolean).join('  ·  ')}</Text>
            </View>
            <Text style={[styles.amount, { color: sign === '-' ? Colors.error : sign === '+' ? Colors.success : Colors.text }]}>{entryAmount(e)}</Text>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.lg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  body: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  main: { flexShrink: 1, fontSize: FontSize.sm, color: Colors.text },
  sub: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  amount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
});
