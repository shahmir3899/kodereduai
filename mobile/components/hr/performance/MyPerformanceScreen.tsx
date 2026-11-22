import React, { useState } from 'react';
import { ScrollView, StyleSheet, type RefreshControlProps } from 'react-native';
import { useMyPerformance } from '../../../hooks/useTeacherPerformance';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { monthRange } from '../../../services/teacherPerformance';
import Skeleton from '../../ui/Skeleton';
import ErrorState from '../../ui/ErrorState';
import EmptyState from '../../ui/EmptyState';
import MonthSwitcher from './MonthSwitcher';
import PerformanceDetail from './PerformanceDetail';
import { Colors, Spacing } from '../../../constants/colors';

const statusOf = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

// Teacher's own report: same breakdown the school's admins see, own figures only.
export default function MyPerformanceScreen() {
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);
  const q = useMyPerformance(range);
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;

  let body: React.ReactNode;
  if (q.isLoading) body = <Skeleton rows={4} />;
  else if (q.isError && statusOf(q.error) === 404) {
    body = <EmptyState title="No report" message="You are not on the teacher performance report for this school." />;
  } else if (q.isError) body = <ErrorState error={q.error} onRetry={q.refetch} />;
  else if (q.data?.enabled === false) {
    body = <EmptyState title="Not available" message="Your school has not turned on the performance report for teachers." />;
  } else if (q.data) body = <PerformanceDetail data={q.data} />;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <MonthSwitcher offset={offset} label={range.label} onChange={setOffset} />
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
});
