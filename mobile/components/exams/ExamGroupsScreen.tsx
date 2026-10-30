import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useExamGroups, useGroupPublishing } from '../../hooks/useExamGroups';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  canAnnounce, groupProgress, progressText, progressTone, resultsReplyText, scheduleReplyText, type ExamGroupRow, type GroupExam,
} from '../../services/examGroups';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Exam groups of the active year: edit the date sheet and publish the schedule or the results, for the
// whole group or one class. Port of the Exams page on the web. Admin and principal only.
export default function ExamGroupsScreen() {
  const q = useExamGroups();
  const refreshControl = useRefreshControl(q.refetch);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <QueryBoundary query={q} emptyTitle="No exam groups" emptyMessage="Create exams for several classes first; they are grouped together.">
        {(groups) => groups.map((g) => <GroupCard key={g.id} group={g} />)}
      </QueryBoundary>
    </ScrollView>
  );
}

function GroupCard({ group }: { group: ExamGroupRow }) {
  const router = useRouter();
  const toast = useToast();
  const pub = useGroupPublishing();
  const [open, setOpen] = useState(false);
  const exams = group.exams ?? [];
  const p = groupProgress(exams);

  const fail = (e: unknown, fallback: string) => toast.error(inventoryErrorMessage(e, fallback));

  const schedule = async (publishing: boolean) => {
    if (!(await confirm({
      title: publishing ? 'Publish the schedule?' : 'Hide the schedule?',
      message: publishing ? `Students, parents and teachers of every class in ${group.name} will see the dates and get a notification.` : 'The dates are hidden from students and parents again.',
      confirmLabel: publishing ? 'Publish' : 'Hide',
    }))) return;
    try {
      const r = await (publishing ? pub.publishSchedule : pub.unpublishSchedule).mutateAsync(group.id);
      toast.success(scheduleReplyText(r.data, publishing));
    } catch (e) { fail(e, 'Could not change the schedule.'); }
  };

  const results = async (announcing: boolean) => {
    if (!(await confirm({
      title: announcing ? 'Announce results?' : 'Withdraw results?',
      message: announcing
        ? 'Classes with every mark entered are announced and parents and students are notified. Classes still missing marks are skipped.'
        : 'Results and report cards are hidden from students and parents again.',
      confirmLabel: announcing ? 'Announce' : 'Withdraw', destructive: !announcing,
    }))) return;
    try {
      const r = await (announcing ? pub.announceResults : pub.unpublishResults).mutateAsync(group.id);
      const { text, partial } = resultsReplyText(r.data, announcing);
      if (partial) toast.show(text, 'info'); else toast.success(text);
    } catch (e) { fail(e, 'Could not change the results.'); }
  };

  const oneExam = async (exam: GroupExam, kind: 'pub' | 'unpub' | 'announce' | 'withdraw') => {
    try {
      if (kind === 'pub') await pub.publishExamSchedule.mutateAsync(exam.id);
      else if (kind === 'unpub') await pub.unpublishExamSchedule.mutateAsync(exam.id);
      else if (kind === 'announce') await pub.announceExam.mutateAsync(exam.id);
      else await pub.unpublishExam.mutateAsync(exam.id);
      toast.success('Done.');
    } catch (e) { fail(e, 'Could not change this class.'); }
  };

  const busy = Object.values(pub).some((m) => m.isPending);

  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{group.name}</Text>
      <Text style={styles.sub}>{[group.exam_type_name, group.term_name, group.start_date && group.end_date ? `${group.start_date} to ${group.end_date}` : null].filter(Boolean).join('  ·  ')}</Text>
      <View style={styles.pills}>
        <StatusPill label={progressText('Schedule', p.schedule, 'published', 'not published')} tone={progressTone(p.schedule)} />
        <StatusPill label={progressText('Results', p.results, 'announced', 'not announced')} tone={progressTone(p.results)} />
      </View>

      <Button title="Edit date sheet" size="sm" variant="outline" onPress={() => router.push({ pathname: '/(admin)/date-sheet', params: { groupId: String(group.id) } } as unknown as Href)} />
      <View style={styles.pair}>
        <Button title="Publish schedule" size="sm" style={styles.half} onPress={() => schedule(true)} disabled={busy} />
        <Button title="Hide schedule" size="sm" variant="secondary" style={styles.half} onPress={() => schedule(false)} disabled={busy || p.schedule.done === 0} />
      </View>
      <View style={styles.pair}>
        <Button title="Announce results" size="sm" style={styles.half} onPress={() => results(true)} disabled={busy || p.results.done === p.results.total} />
        <Button title="Withdraw results" size="sm" variant="danger" style={styles.half} onPress={() => results(false)} disabled={busy || p.results.done === 0} />
      </View>

      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.toggle}>
        <Text style={styles.toggleText}>{open ? 'Hide classes' : `Classes (${exams.length})`}</Text>
      </TouchableOpacity>
      {open ? exams.map((e) => (
        <View key={e.id} style={styles.examRow}>
          <View style={styles.who}>
            <Text style={styles.examName}>{e.class_name ?? 'Class'}</Text>
            <Text style={styles.sub}>{`${e.schedule_published_at ? 'Schedule published' : 'Schedule hidden'}  ·  ${e.status === 'PUBLISHED' ? 'Results announced' : e.marks_entry_complete ? 'Marks complete' : `Marks ${e.marks_entered_count ?? 0}/${e.marks_expected_count ?? 0}`}`}</Text>
          </View>
          <View style={styles.rowActions}>
            <Button title={e.schedule_published_at ? 'Hide' : 'Publish'} size="sm" variant="outline" disabled={busy} onPress={() => oneExam(e, e.schedule_published_at ? 'unpub' : 'pub')} />
            {e.status === 'PUBLISHED'
              ? <Button title="Withdraw" size="sm" variant="outline" disabled={busy} onPress={() => oneExam(e, 'withdraw')} />
              : <Button title="Announce" size="sm" variant="outline" disabled={busy || !canAnnounce(e)} onPress={() => oneExam(e, 'announce')} />}
          </View>
        </View>
      )) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.sm },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  pills: { gap: Spacing.xs, alignItems: 'flex-start' },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { color: Colors.primary, fontWeight: '600', fontSize: FontSize.sm },
  examRow: { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.sm, gap: Spacing.xs },
  who: { flex: 1 },
  examName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  rowActions: { flexDirection: 'row', gap: Spacing.sm },
});
