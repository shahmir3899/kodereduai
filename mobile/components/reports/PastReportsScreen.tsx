import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, type RefreshControlProps } from 'react-native';
import { reportsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { storedReportError, storedReportFileName, storedReportKind, storedReportLine, type StoredReport } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Reports the server stored earlier (the 50 newest), each shared through the phone's share sheet. Admin
// and principal only: a stored student report can hold a whole record. New reports are made on the
// screens that need them (finance, students), not here.
export default function PastReportsScreen() {
  const toast = useToast();
  const q = useScopedQuery<StoredReport[]>('storedReports', [], async () => listOf<StoredReport>((await reportsApi.getList()).data), { staleTime: 0, retry: false });
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  const [busy, setBusy] = useState<number | null>(null);

  const share = async (r: StoredReport) => {
    setBusy(r.id);
    try {
      await shareReportFile(() => reportsApi.download(r.id) as Promise<{ data: ArrayBuffer }>, storedReportFileName(r), storedReportKind(r));
    } catch (e) {
      toast.error((e as { response?: unknown })?.response ? storedReportError(e) : (e as Error)?.message || storedReportError(e));
    } finally { setBusy(null); }
  };

  if (q.isLoading) return <Skeleton variant="list" />;
  if (q.isError && !q.data) {
    const denied = (q.error as { response?: { status?: number } })?.response?.status === 403;
    return denied ? <EmptyState title="Not available" message="Only admin and principal can open stored reports." /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={q.data ?? []}
      keyExtractor={(r) => String(r.id)}
      refreshControl={refreshControl}
      ListEmptyComponent={<EmptyState title="No stored reports" message="Reports are made when you ask for them, for example from a student's profile or Finance." />}
      renderItem={({ item: r }) => (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={2}>{r.title}</Text>
            <Text style={styles.sub}>{storedReportLine(r)}</Text>
          </View>
          <Button title="Share" size="sm" variant="outline" loading={busy === r.id} disabled={busy !== null} onPress={() => share(r)} />
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
});
