import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api';
import { useMyJobs } from '../../hooks/useMyJobs';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { JOB_STATUS, isActiveJob, progressFraction, progressText, type BackgroundJob } from '../../services/backgroundJobs';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import QueryList from '../ui/QueryList';
import StatusPill from '../ui/StatusPill';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { dayTime } from '../../services/dates';

// Jobs this person started in the last 24 hours (payslips, fee generation, report PDFs, timetable,
// promotions...), on the phone or the web: progress while running, cancel, and why one failed.
// Results are opened from the screen that made them; this list only tracks the work.
export default function RunningJobsScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useMyJobs();
  const refreshControl = useRefreshControl(q.refetch);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const cancel = async (j: BackgroundJob) => {
    const ok = await confirm({
      title: 'Cancel job?', message: `${j.title} will stop. Work it already finished is not undone.`,
      confirmLabel: 'Cancel job', cancelLabel: 'Keep running', destructive: true,
    });
    if (!ok) return;
    setCancelling(j.celery_task_id);
    try {
      await tasksApi.cancelTask(j.celery_task_id);
      toast.success('Job cancelled.');
    } catch (e) {
      toast.error(staffLeaveErrorMessage(e, 'Could not cancel the job.'));
    } finally {
      setCancelling(null);
      qc.invalidateQueries({ predicate: (x) => x.queryKey[0] === 'myJobs' });
    }
  };

  return (
    <QueryList
      query={q}
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
      emptyTitle="No jobs"
      emptyMessage="Payslips, fee generation and report files you start show here while they run."
      keyExtractor={(j) => j.celery_task_id}
      extraData={cancelling}
      header={<Text style={styles.intro}>Jobs you started in the last 24 hours, here or on the web. Open results from the screen that made them.</Text>}
      renderItem={(j) => {
          const st = JOB_STATUS[j.status] ?? JOB_STATUS.PENDING;
          const pct = progressFraction(j);
          const line = progressText(j);
          return (
            <Card style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={2}>{j.title}</Text>
                <StatusPill label={st.label} tone={st.tone} />
              </View>
              {pct != null ? <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View> : null}
              {line ? <Text style={styles.sub}>{line}</Text> : null}
              {j.status === 'FAILED' && j.error_message ? <Text style={styles.error}>{j.error_message}</Text> : null}
              <Text style={styles.time}>Started {dayTime(j.created_at)}</Text>
              {isActiveJob(j) ? (
                <Button title={cancelling === j.celery_task_id ? 'Cancelling...' : 'Cancel'} size="sm" variant="outline" style={styles.cancel}
                  disabled={cancelling != null} onPress={() => cancel(j)} />
              ) : null}
            </Card>
          );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  intro: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { padding: Spacing.md, gap: Spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  track: { height: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden', marginTop: Spacing.xs },
  fill: { height: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.primary },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  error: { fontSize: FontSize.sm, color: Colors.error },
  time: { fontSize: FontSize.xs, color: Colors.textTertiary },
  cancel: { alignSelf: 'flex-start', marginTop: Spacing.xs },
});
