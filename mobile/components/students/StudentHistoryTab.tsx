import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useEnrollmentHistory } from '../../hooks/useStudents';
import { awayLine, enrollmentLine, enrollmentTitle, enrollmentTone, placementsLine, type AwayPeriod } from '../../services/studentLifecycle';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  studentId: number;
  awayPeriods?: AwayPeriod[];
}

// The student's class and roll in every academic year, any mid-year move, and any time away.
export default function StudentHistoryTab({ studentId, awayPeriods }: Props) {
  const history = useEnrollmentHistory(studentId, true);
  const denied = history.isError && (history.error as { response?: { status?: number } })?.response?.status === 403;

  if (history.isLoading) return <Skeleton rows={3} />;
  if (denied) return <EmptyState title="Not available" message="History isn't available for your role." />;
  if (history.isError && !history.data) return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  const rows = history.data ?? [];

  return (
    <View>
      {(awayPeriods ?? []).length > 0 ? (
        <>
          <Text style={styles.groupTitle}>Time away</Text>
          <Card style={styles.card}>
            {(awayPeriods ?? []).map((p, i) => <Text key={i} style={styles.line}>{awayLine(p)}</Text>)}
            <Text style={styles.note}>Nothing is billed, rostered or recorded for the time away.</Text>
          </Card>
        </>
      ) : null}
      {rows.length === 0 ? <EmptyState title="No enrollment history" /> : rows.map((e, i) => {
        const moved = placementsLine(e);
        return (
          <Card key={`${enrollmentTitle(e)}-${i}`} style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.title}>{enrollmentTitle(e)}{e.branch ? `  ·  ${e.branch}` : ''}</Text>
              {e.status ? <StatusPill label={e.status[0] + e.status.slice(1).toLowerCase()} tone={enrollmentTone(e.status)} /> : null}
            </View>
            <Text style={styles.line}>{enrollmentLine(e) || '—'}</Text>
            {moved ? <Text style={styles.note}>{moved}</Text> : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  groupTitle: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: Spacing.sm },
  card: { marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  line: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
});
