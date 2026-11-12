import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useLibraryActions, useOverdue } from '../../hooks/useLibrary';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { issueLine, returnConfirmText, returnedText, rupees, type IssueRow } from '../../services/library';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Books past their due date, most overdue first, with the fine each has built up. A book can be taken
// back from here. Admin and principal only.
export default function OverdueScreen() {
  const toast = useToast();
  const { isSchoolAdminNav: canManage } = useAuth();
  const actions = useLibraryActions();
  const query = useOverdue();
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const [busy, setBusy] = useState<number | null>(null);

  const giveBack = async (i: IssueRow) => {
    if (!(await confirm({ title: 'Return this book?', message: returnConfirmText(i), confirmLabel: 'Return' }))) return;
    setBusy(i.id);
    try {
      const res = await actions.returnBook.mutateAsync(i.id);
      toast.success(returnedText(res.data as { fine_amount?: string | number }));
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not process the return.')); }
    finally { setBusy(null); }
  };

  if (query.isLoading) return <Skeleton variant="list" />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const rows = [...(query.data ?? [])].sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(i) => String(i.id)}
      refreshControl={refreshControl}
      ListEmptyComponent={<EmptyState title="Nothing overdue" message="Every book out is within its loan period." />}
      renderItem={({ item: i }) => (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={2}>{i.book_title}</Text>
            <Text style={styles.sub}>{issueLine(i)}</Text>
            {Number(i.estimated_fine) > 0 ? <Text style={styles.fine}>{`Fine so far ${rupees(i.estimated_fine)}`}</Text> : null}
          </View>
          {canManage ? <Button title="Return" size="sm" variant="outline" loading={busy === i.id} disabled={busy !== null} onPress={() => giveBack(i)} /> : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  fine: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.error },
});
