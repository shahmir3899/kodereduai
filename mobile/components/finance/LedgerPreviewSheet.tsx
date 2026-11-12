import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import type { AccountBalance } from '../../services/financeManager';
import { useLedgerPreview } from '../../hooks/useFinanceManager';
import { formatMoney } from '../../services/feeCollect';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The ten newest ledger lines of the tapped account (credit, debit, running balance), as the web
// preview does, with a button to the full ledger. Read-only.
// `schoolId` is the school the account belongs to when it is not the active one; the full ledger
// screen only reads the active school, so its button is shown only for the active school's accounts.
export default function LedgerPreviewSheet({ account, schoolId, canOpenFull = true, onClose, onFull }: {
  account: AccountBalance | null; schoolId?: number | null; canOpenFull?: boolean; onClose: () => void; onFull: (a: AccountBalance) => void;
}) {
  const q = useLedgerPreview(account?.id ?? null, schoolId);
  const entries = q.data?.entries ?? [];
  return (
    <BottomSheet visible={account !== null} onClose={onClose} title={account ? `${account.name}${account.account_type ? ` · ${account.account_type}` : ''}` : ''}>
      <ScrollView contentContainerStyle={styles.body}>
        {q.isLoading ? <Text style={styles.muted}>Loading…</Text> : q.isError ? <Text style={styles.muted}>Could not load the ledger.</Text> : entries.length === 0 ? (
          <Text style={styles.muted}>No transactions yet for this account.</Text>
        ) : (
          <>
            <View style={styles.balance}>
              <Text style={styles.balanceLabel}>Current balance</Text>
              <Text style={styles.balanceValue}>{formatMoney(Number(q.data?.closing_balance ?? 0) || 0)}</Text>
            </View>
            {entries.map((e, i) => (
              <View key={`${e.id}-${i}`} style={styles.entry} accessible accessibilityLabel={`${e.date ?? ''} ${e.description}`}>
                <View style={styles.entryMain}>
                  <Text style={styles.desc} numberOfLines={1}>{e.description}</Text>
                  <Text style={styles.date}>{e.date || '—'}</Text>
                </View>
                <View style={styles.nums}>
                  {Number(e.credit) > 0 ? <Text style={[styles.num, { color: Colors.success }]}>+{formatMoney(Number(e.credit))}</Text> : null}
                  {Number(e.debit) > 0 ? <Text style={[styles.num, { color: Colors.error }]}>-{formatMoney(Number(e.debit))}</Text> : null}
                  <Text style={styles.running}>{formatMoney(Number(e.running_balance) || 0)}</Text>
                </View>
              </View>
            ))}
          </>
        )}
        {account && canOpenFull ? <Button title="View full ledger" onPress={() => onFull(account)} /> : null}
        <Button title="Close" variant="outline" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  balance: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md },
  balanceLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  balanceValue: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  entry: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.xs },
  entryMain: { flex: 1 },
  desc: { fontSize: FontSize.sm, color: Colors.text },
  date: { fontSize: FontSize.xs, color: Colors.textTertiary },
  nums: { alignItems: 'flex-end' },
  num: { fontSize: FontSize.sm, fontWeight: '600' },
  running: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
