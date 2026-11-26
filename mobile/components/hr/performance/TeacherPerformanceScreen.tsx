import React, { useState } from 'react';
import { ScrollView, Text, View, StyleSheet, type RefreshControlProps } from 'react-native';
import { useTeacherPerformanceDetail, useTeacherPerformanceReport } from '../../../hooks/useTeacherPerformance';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { teacherPerformanceApi } from '../../../services/api';
import { shareReportFile } from '../../../services/reportShare';
import { bandTone, exportFileName, formatScore, monthRange } from '../../../services/teacherPerformance';
import RecordCard from '../../ui/RecordCard';
import Button from '../../ui/Button';
import Skeleton from '../../ui/Skeleton';
import ErrorState from '../../ui/ErrorState';
import EmptyState from '../../ui/EmptyState';
import { useToast } from '../../ui/Toast';
import MonthSwitcher from './MonthSwitcher';
import PerformanceDetail from './PerformanceDetail';
import PerformanceInfoButton from './PerformanceInfoButton';
import { Colors, FontSize, Spacing } from '../../../constants/colors';
import AppList from '../../ui/AppList';
import { day } from '../../../services/dates';

// Admin and principal: ranked list for a month, a teacher's breakdown, and the PDF / Excel export
// shared through the phone's share sheet. Settings stay on the web.
export default function TeacherPerformanceScreen() {
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const range = monthRange(offset);
  const list = useTeacherPerformanceReport(range);
  const detail = useTeacherPerformanceDetail(openId, range);
  const refreshControl = useRefreshControl(openId ? detail.refetch : list.refetch) as React.ReactElement<RefreshControlProps>;

  const share = async (kind: 'pdf' | 'xlsx') => {
    setBusy(kind);
    try {
      await shareReportFile(
        () => teacherPerformanceApi.exportReport({ start: range.start, end: range.end, format: kind === 'pdf' ? 'PDF' : 'XLSX' }),
        exportFileName(range.start, range.end, kind),
        kind,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not export the report.');
    } finally {
      setBusy(null);
    }
  };

  if (openId) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="← All teachers" variant="outline" size="sm" onPress={() => setOpenId(null)} />
        {detail.isLoading ? <Skeleton rows={4} /> : detail.isError ? (
          <ErrorState error={detail.error} onRetry={detail.refetch} />
        ) : detail.data ? <PerformanceDetail data={detail.data} /> : null}
      </ScrollView>
    );
  }

  const header = (
    <View style={styles.headerBox}>
      <MonthSwitcher offset={offset} label={range.label} onChange={setOffset} />
      {list.data ? (
        <View style={styles.row}>
          <Text style={styles.muted}>
            {list.data.out_of ?? 0} ranked · {list.data.snapshot && list.data.frozen_at
              ? `frozen on ${day(list.data.frozen_at)}`
              : `counted until ${list.data.period.counted_until}`}
          </Text>
          <PerformanceInfoButton />
        </View>
      ) : null}
      <View style={styles.row}>
        <Button title="Share PDF" variant="outline" size="sm" loading={busy === 'pdf'} disabled={!!busy} onPress={() => share('pdf')} />
        <Button title="Share Excel" variant="outline" size="sm" loading={busy === 'xlsx'} disabled={!!busy} onPress={() => share('xlsx')} />
      </View>
    </View>
  );

  if (list.isLoading) return <View style={[styles.page, styles.content]}>{header}<Skeleton rows={5} /></View>;
  if (list.isError) return <View style={[styles.page, styles.content]}>{header}<ErrorState error={list.error} onRetry={list.refetch} /></View>;

  return (
    <AppList
      style={styles.page}
      contentContainerStyle={styles.content}
      data={list.data?.teachers ?? []}
      keyExtractor={(t) => String(t.staff_id)}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <EmptyState title="No teachers to score" message="Only active teaching staff with a login for this school appear here." />
      }
      renderItem={({ item: t }) => (
        <RecordCard
          title={t.name}
          subtitle={t.rank ? `Rank ${t.rank} of ${list.data?.out_of}` : 'Not ranked'}
          meta={t.quickest_wins.length ? `Quickest wins: ${t.quickest_wins.map((w) => w.label).join(', ')}` : undefined}
          avatarName={t.name}
          status={t.band ? { label: t.band.label, tone: bandTone(t.band) } : undefined}
          trailing={formatScore(t.overall_score)}
          onPress={() => setOpenId(t.staff_id)}
          accessibilityLabel={`${t.name}, score ${formatScore(t.overall_score)}${t.band ? `, ${t.band.label}` : ''}. Open details`}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
  headerBox: { gap: Spacing.sm, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
