import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Linking, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useAdmissionsActions, useEnquiriesPaged, useFollowups, useStatusCounts,
} from '../../hooks/useAdmissions';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  admissionsErrorMessage, canCancel, canConfirm, canConvert, canDeleteCancelled, conversionRate, filterEnquiries, followUpState,
  formatDay, gradeLabel, GRADES, hasFilters, NO_FILTERS, SOURCES, sourceLabel, STATUSES, statusLabel, statusTone, telUrl,
  type Enquiry, type FollowUpFilter, type ListFilters, type EnquiryStatus,
} from '../../services/admissions';
import { schoolToday } from '../../services/schoolTime';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import EnquiryFormSheet from './EnquiryFormSheet';
import ConvertSheet from './ConvertSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ANY = -1;
const ANY_TEXT = '';

// Enquiries with the admission funnel, filters, follow-ups and, for confirmed ones, conversion to
// students. Admin and principal only (the navigation never offers it to anyone else).
export default function EnquiriesScreen() {
  const router = useRouter();
  const toast = useToast();
  const actions = useAdmissionsActions();
  const counts = useStatusCounts();
  const today = schoolToday();

  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [status, setStatus] = useState<'' | EnquiryStatus>('');
  const [grade, setGrade] = useState<number | null>(null);
  const [source, setSource] = useState(ANY_TEXT);
  const [followUp, setFollowUp] = useState<FollowUpFilter>('');
  const filters: ListFilters = { status, grade, source, search: term };

  const paged = useEnquiriesPaged(filters, followUp === '');
  const dueToday = useFollowups('today');
  const overdue = useFollowups('overdue');
  const followList = followUp === 'today' ? dueToday : overdue;
  const active = followUp === '' ? paged : followList;
  const refreshControl = useRefreshControl(async () => {
    await Promise.all([active.refetch(), counts.refetch(), dueToday.refetch(), overdue.refetch()]);
  }) as React.ReactElement<RefreshControlProps>;

  const rows = useMemo(() => {
    if (followUp === '') return paged.data?.pages.flatMap((p) => p.results) ?? [];
    return filterEnquiries(followList.data ?? [], filters);
    // filters is rebuilt each render from the four pieces below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUp, paged.data, followList.data, status, grade, source, term]);
  const total = followUp === '' ? paged.data?.pages[0]?.count ?? 0 : rows.length;

  const [picked, setPicked] = useState<Record<number, Enquiry>>({});
  const pickedRows = Object.values(picked);
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState(false);

  const togglePick = (e: Enquiry) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[e.id]) delete next[e.id];
      else next[e.id] = e;
      return next;
    });

  const pickAllConfirmed = () => {
    const confirmed = rows.filter(canConvert);
    const allOn = confirmed.length > 0 && confirmed.every((e) => picked[e.id]);
    setPicked((p) => {
      const next = { ...p };
      confirmed.forEach((e) => (allOn ? delete next[e.id] : (next[e.id] = e)));
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setGrade(null);
    setSource(ANY_TEXT);
    setFollowUp('');
  };

  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast.success(done);
    } catch (e) {
      toast.error(admissionsErrorMessage(e));
    }
  };

  const confirmEnquiry = (e: Enquiry) => run(() => actions.setStatus.mutateAsync({ id: e.id, status: 'CONFIRMED' }), 'Enquiry confirmed.');

  // Cancelling deletes the enquiry and its notes for good (owner's call, 2026-10-29), as on the web.
  const cancelEnquiry = async (e: Enquiry) => {
    const ok = await confirm({
      title: 'Cancel enquiry',
      message: `Cancel the enquiry for ${e.name}? It is deleted for good, with its notes.`,
      confirmLabel: 'Cancel enquiry', cancelLabel: 'Keep it', destructive: true,
    });
    if (!ok) return;
    setPicked((p) => { const n = { ...p }; delete n[e.id]; return n; });
    await run(() => actions.deleteEnquiry.mutateAsync(e.id), 'Enquiry deleted.');
  };

  const deleteCancelled = async (e: Enquiry) => {
    const ok = await confirm({ title: 'Delete enquiry', message: `Delete the enquiry for ${e.name}?`, confirmLabel: 'Delete', destructive: true });
    if (ok) await run(() => actions.deleteEnquiry.mutateAsync(e.id), 'Enquiry deleted.');
  };

  const call = (e: Enquiry) => {
    const url = telUrl(e.mobile);
    if (url) Linking.openURL(url).catch(() => toast.error('Could not open the phone app.'));
  };

  const c = counts.data;
  const funnel = (
    <View style={styles.card}>
      <View style={styles.rateRow}>
        <Text style={styles.cardTitle}>Admission funnel</Text>
        <Text style={styles.rate} accessibilityLabel={`${c ? conversionRate(c) : 0} percent of enquiries converted`}>{c ? conversionRate(c) : 0}%</Text>
      </View>
      <View style={styles.stageGrid}>
        {STATUSES.map((s) => {
          const on = status === s.value;
          return (
            <TouchableOpacity
              key={s.value} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={`${s.label}: ${c?.[s.value] ?? 0}. ${on ? 'Showing only these' : 'Tap to filter'}`}
              style={[styles.stage, on && styles.stageOn]} onPress={() => { setFollowUp(''); setStatus(on ? '' : s.value); }}
            >
              <Text style={styles.stageCount}>{c?.[s.value] ?? 0}</Text>
              <Text style={styles.stageLabel}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const followChips = (
    <View style={styles.chips}>
      {([['today', 'Follow up today', dueToday.data?.length], ['overdue', 'Overdue', overdue.data?.length]] as const).map(([key, label, n]) => {
        const on = followUp === key;
        return (
          <TouchableOpacity
            key={key} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[styles.chip, on && styles.chipOn, key === 'overdue' && !!n && !on && styles.chipWarn]}
            onPress={() => setFollowUp(on ? '' : key)}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}{n === undefined ? '' : ` (${n})`}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const header = (
    <View>
      {funnel}
      {followChips}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search child, father or phone..." />
      <View style={styles.filterRow}>
        <View style={styles.half}>
          <Select
            label="Grade" value={grade ?? ANY} onChange={(v) => setGrade(v === ANY ? null : v)}
            options={[{ value: ANY, label: 'All grades' }, ...GRADES.map((g) => ({ value: g.value, label: g.label }))]}
          />
        </View>
        <View style={styles.half}>
          <Select
            label="Source" value={source} onChange={(v) => setSource(v)}
            options={[{ value: ANY_TEXT, label: 'All sources' }, ...SOURCES.map((s) => ({ value: s.value, label: s.label }))]}
          />
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.count}>{total} enquir{total === 1 ? 'y' : 'ies'}</Text>
        {hasFilters(filters, followUp) ? (
          <TouchableOpacity accessibilityRole="button" onPress={clearFilters}><Text style={styles.link}>Clear filters</Text></TouchableOpacity>
        ) : null}
        {rows.some(canConvert) ? (
          <TouchableOpacity accessibilityRole="button" onPress={pickAllConfirmed}><Text style={styles.link}>Select confirmed</Text></TouchableOpacity>
        ) : null}
      </View>
      <Button title="+ New enquiry" size="sm" onPress={() => setCreating(true)} />
    </View>
  );

  if (active.isLoading) return <View style={styles.container}><View style={styles.content}>{funnel}</View><Skeleton /></View>;
  if (active.isError && !active.data) return <ErrorState error={active.error} onRetry={() => active.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={[styles.content, pickedRows.length > 0 && { paddingBottom: 96 }]}
        data={rows}
        keyExtractor={(e) => String(e.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => followUp === '' && paged.hasNextPage && !paged.isFetchingNextPage && paged.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No enquiries" message={hasFilters(filters, followUp) ? 'No enquiries match the filters.' : 'No enquiries yet. Tap New enquiry to add one.'} />}
        ListFooterComponent={followUp === '' && paged.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item }) => {
          const due = followUpState(item, today);
          const isPicked = !!picked[item.id];
          return (
            <View style={[styles.row, isPicked && styles.rowPicked]}>
              <View style={styles.rowTop}>
                {canConvert(item) ? (
                  <TouchableOpacity
                    accessibilityRole="checkbox" accessibilityState={{ checked: isPicked }} accessibilityLabel={`Select ${item.name} for conversion`}
                    style={styles.checkHit} onPress={() => togglePick(item)}
                  >
                    <View style={[styles.box, isPicked && styles.boxOn]}>{isPicked ? <Text style={styles.tick}>✓</Text> : null}</View>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  accessibilityRole="button" accessibilityLabel={`Open enquiry for ${item.name}`}
                  style={styles.who} onPress={() => router.push({ pathname: '/(admin)/admissions/[id]', params: { id: String(item.id) } })}
                >
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{item.father_name} · {item.mobile}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {gradeLabel(item.applying_for_grade_level)} · {item.source_display ?? sourceLabel(item.source)}
                    {item.next_followup_date ? ` · follow up ${formatDay(item.next_followup_date)}` : ''}
                  </Text>
                </TouchableOpacity>
                <View style={styles.right}>
                  <StatusPill label={item.status_display ?? statusLabel(item.status)} tone={statusTone(item.status)} />
                  {due === 'overdue' ? <Text style={styles.overdue}>Overdue</Text> : due === 'today' ? <Text style={styles.dueToday}>Today</Text> : null}
                </View>
              </View>
              <View style={styles.actions}>
                {telUrl(item.mobile) ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Call ${item.father_name}`} style={styles.action} onPress={() => call(item)}>
                    <Text style={styles.actionText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
                {canConfirm(item) ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Confirm enquiry for ${item.name}`} style={styles.action} onPress={() => confirmEnquiry(item)}>
                    <Text style={[styles.actionText, { color: Colors.success }]}>Confirm</Text>
                  </TouchableOpacity>
                ) : null}
                {canCancel(item) ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Cancel enquiry for ${item.name}`} style={styles.action} onPress={() => cancelEnquiry(item)}>
                    <Text style={[styles.actionText, { color: Colors.error }]}>Cancel</Text>
                  </TouchableOpacity>
                ) : null}
                {canDeleteCancelled(item) ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete enquiry for ${item.name}`} style={styles.action} onPress={() => deleteCancelled(item)}>
                    <Text style={[styles.actionText, { color: Colors.error }]}>Delete</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        }}
      />

      {pickedRows.length > 0 ? (
        <View style={styles.bar}>
          <Text style={styles.barText}>{pickedRows.length} confirmed selected</Text>
          <View style={styles.barActions}>
            <Button title="Clear" size="sm" variant="ghost" onPress={() => setPicked({})} />
            <Button title="Convert to students" size="sm" onPress={() => setConverting(true)} />
          </View>
        </View>
      ) : null}

      <EnquiryFormSheet visible={creating} enquiry={null} onClose={() => setCreating(false)} />
      <ConvertSheet
        visible={converting} enquiries={pickedRows} onClose={() => setConverting(false)}
        onDone={(summary) => {
          setConverting(false);
          setPicked({});
          if (summary.allFailed) toast.error(summary.failures[0] ?? summary.message);
          else {
            toast.success(summary.message);
            if (summary.failures.length) toast.error(`${summary.failures.length} failed: ${summary.failures[0]}`);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: Spacing.sm },
  rate: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  stageGrid: { flexDirection: 'row', gap: Spacing.sm },
  stage: { flex: 1, minHeight: 56, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.sm },
  stageOn: { borderColor: Colors.primary, backgroundColor: Colors.background },
  stageCount: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  stageLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  chips: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: Spacing.md, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipWarn: { borderColor: Colors.error },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.textInverse },
  filterRow: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginVertical: Spacing.sm },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, flex: 1 },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', minHeight: 32, textAlignVertical: 'center' },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm },
  rowPicked: { borderWidth: 1.5, borderColor: Colors.primary },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkHit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tick: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: '700' },
  who: { flex: 1, minHeight: 44, justifyContent: 'center' },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  overdue: { fontSize: FontSize.xs, color: Colors.error, fontWeight: '700' },
  dueToday: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.xs, flexWrap: 'wrap' },
  action: { minHeight: 40, minWidth: 44, justifyContent: 'center' },
  actionText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  barActions: { flexDirection: 'row', gap: Spacing.sm },
});
