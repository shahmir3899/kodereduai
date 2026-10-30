import React, { useMemo } from 'react';
import type { Q } from './types';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useStudentLibrary } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { splitIssues, totalFines, type LibraryIssue } from '../../services/studentPortal';
import { formatMoney } from '../../services/feeCollect';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Books the student has borrowed: what is out now, then the history.
export function LibraryView({ query }: { query: Q<LibraryIssue[]> }) {
  const refreshControl = useRefreshControl(query.refetch);
  const { current, past } = useMemo(() => splitIssues(query.data ?? []), [query.data]);
  const fines = totalFines(query.data ?? []);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if ((query.data ?? []).length === 0) return <EmptyState title="No books yet" message="Books borrowed from the school library show here." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {fines > 0 ? <Text style={styles.fines}>Fines: {formatMoney(fines)}</Text> : null}
      <Text style={styles.section}>Borrowed now</Text>
      {current.length === 0 ? <Text style={styles.muted}>Nothing borrowed at the moment.</Text> : current.map((i) => <Row key={i.id} issue={i} />)}
      {past.length > 0 ? <Text style={styles.section}>History</Text> : null}
      {past.map((i) => <Row key={i.id} issue={i} />)}
    </ScrollView>
  );
}

function Row({ issue: i }: { issue: LibraryIssue }) {
  const fine = Number(i.fine_amount) || 0;
  return (
    <Card style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>{i.book_title}</Text>
        {i.book_author ? <Text style={styles.meta}>{i.book_author}</Text> : null}
        <Text style={styles.meta}>
          Issued {i.issue_date}  ·  {i.return_date ? `Returned ${i.return_date}` : `Due ${i.due_date}`}
          {fine > 0 ? `  ·  Fine ${formatMoney(fine)}` : ''}
        </Text>
      </View>
      {i.return_date ? <StatusPill label="Returned" tone="neutral" />
        : <StatusPill label={i.is_overdue ? 'Overdue' : 'Issued'} tone={i.is_overdue ? 'error' : 'info'} />}
    </Card>
  );
}

export default function StudentLibraryScreen() {
  return <LibraryView query={useStudentLibrary()} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  fines: { fontSize: FontSize.md, fontWeight: '700', color: Colors.error, marginBottom: Spacing.sm },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.md, marginBottom: Spacing.sm },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, marginBottom: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
