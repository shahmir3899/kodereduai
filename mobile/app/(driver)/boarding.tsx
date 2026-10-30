import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { useBoardingRoster, useSaveBoarding } from '../../hooks/useDriver';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  BOARDING_LABEL, BOARDING_TONE, boardingCounts, changedRecords, groupByStop, markAll, nextBoarding, statusOf,
  type Draft,
} from '../../services/driver';
import { apiErrorMessage } from '../../services/parentPortal';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import StatusPill from '../../components/ui/StatusPill';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { saveFailureMessage } from '../../services/errorKind';

// Who got on the bus today. Tap a student to cycle Boarded / Not boarded / Absent, then save.
// The route is the one on the driver's own vehicle and only today can be marked.
export default function BoardingScreen() {
  const toast = useToast();
  const query = useBoardingRoster();
  const save = useSaveBoarding();
  const refreshControl = useRefreshControl(query.refetch);
  const [draft, setDraft] = useState<Draft>({});

  const students = query.data?.students ?? [];
  const sections = useMemo(() => groupByStop(students).map((g) => ({ title: g.title, data: g.students })), [students]);
  const counts = boardingCounts(students, draft);
  const pending = changedRecords(students, draft);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) {
    const message = apiErrorMessage((query.error as { response?: { data?: unknown } } | null)?.response?.data, '');
    return message ? <EmptyState title="No route to mark" message={message} /> : <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (students.length === 0) return <EmptyState title="No students on your route" message="Nobody is assigned to your route yet." />;

  const submit = () => {
    save.mutateAsync(pending)
      .then((res) => {
        const errors = (res.data as { errors?: unknown[] }).errors ?? [];
        setDraft({});
        if (errors.length) toast.error(`${errors.length} student${errors.length === 1 ? ' was' : 's were'} not saved.`);
        else toast.success('Boarding saved.');
      })
      .catch((e: any) => toast.error(e?.response ? apiErrorMessage(e?.response?.data, 'Could not save. Your marks are kept: try again.') : saveFailureMessage(e)));
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(s) => String(s.student_id)}
        refreshControl={refreshControl}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.summary}>
            <Text style={styles.route}>{query.data?.route.name} · {query.data?.date}</Text>
            <Text style={styles.counts}>
              {counts.BOARDED} boarded · {counts.NOT_BOARDED} not boarded · {counts.ABSENT} absent · {counts.unmarked} unmarked
            </Text>
            {counts.unmarked > 0 ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => setDraft(markAll(students, 'BOARDED', draft))}>
                <Text style={styles.link}>Mark all unmarked as boarded</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.stop}>{section.title}</Text>}
        renderItem={({ item: s }) => {
          const st = statusOf(s, draft);
          return (
            <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => setDraft({ ...draft, [s.student_id]: nextBoarding(st) })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{[s.class_name, s.roll_number ? `Roll #${s.roll_number}` : ''].filter(Boolean).join('  ·  ')}</Text>
              </View>
              {st ? <StatusPill label={BOARDING_LABEL[st]} tone={BOARDING_TONE[st]} /> : <Text style={styles.tap}>Tap to mark</Text>}
            </TouchableOpacity>
          );
        }}
      />
      {pending.length > 0 ? (
        <View style={styles.footer}>
          <Button title={`Save ${pending.length} change${pending.length === 1 ? '' : 's'}`} onPress={submit} loading={save.isPending} fullWidth size="lg" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  summary: { marginBottom: Spacing.md },
  route: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  counts: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  link: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary, marginTop: Spacing.sm },
  stop: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  tap: { fontSize: FontSize.sm, color: Colors.textTertiary },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
