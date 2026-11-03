import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { ClassOption } from '../../services/attendanceEntry';
import { STATUS_SCOPES, statusLabel, statusTone, summaryTiles, type StatusScope } from '../../services/students';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useStudentCounts, useStudentsPaged } from '../../hooks/useStudents';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import RecordCard from '../ui/RecordCard';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import { selectedAll, toggleAll, toggleId } from '../../services/questionExtras';
import { accountableIds } from '../../services/studentBulk';
import type { BulkStudent } from '../../services/bulkReportCards';
import { BulkAccountsSheet, BulkReportsSheet } from './BulkStudentSheets';
import RenumberSectionSheet from './RenumberSectionSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ALL = 0;

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
  // Admin and principal only: shows the Add student button.
  canAdd?: boolean;
}

// Students the role may see, with search and a class filter. Details open the profile; admins can also add and filter by status.
export default function StudentsListScreen({ classOptions, canAdd }: Props) {
  const router = useRouter();
  const base = usePersonaBase();
  const { class: classParam } = useLocalSearchParams<{ class?: string }>();
  const { options } = useAttendanceClassOptions(classOptions);
  const [classId, setClassId] = useState<number>(ALL);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<StatusScope>('current');
  const term = useDebouncedValue(search.trim(), 400);

  // Opened from the Classes screen: start on that section.
  useEffect(() => {
    const wanted = classParam ? Number(classParam) : null;
    if (wanted && options.some((o) => o.id === wanted)) setClassId(wanted);
  }, [classParam, options]);

  const option = classId === ALL ? null : options.find((o) => o.id === classId) ?? null;
  const query = useStudentsPaged(term, option, scope);
  const refreshControl = useRefreshControl(query.refetch);
  const students = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const total = query.data?.pages[0]?.count ?? 0;
  const counts = useStudentCounts(!!canAdd);
  const tiles = summaryTiles(counts, options.length);

  // Choosing students is page-scoped (admin and principal): ids from a list no longer on screen must not ride along.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [sheet, setSheet] = useState<'accounts' | 'reports' | 'renumber' | null>(null);
  // Only one section at a time, and only a section (a class with no sections has no roll to re-number).
  const renumberSection = canAdd && option?.isSession ? { id: option.id, label: option.label } : null;
  const listKey = `${term}|${classId}|${scope}`;
  useEffect(() => { setSelected([]); }, [listKey]);
  const shownIds = students.map((s) => s.id);
  const loginIds = accountableIds(students, selected);
  const picked: BulkStudent[] = students.filter((s) => selected.includes(s.id)).map((s) => ({ studentId: s.id, enrollmentId: null, name: s.name, roll: s.roll_number }));

  const header = (
    <View>
      {canAdd ? (
        <View style={styles.tiles}>
          {tiles.map((t) => (
            <View key={t.label} style={styles.tile} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
              <Text style={[styles.tileValue, { color: t.tone === 'success' ? Colors.success : t.tone === 'info' ? Colors.primary : Colors.text }]}>{t.value}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {canAdd ? <Button title="Add student" size="sm" onPress={() => router.push(`${base}/students/new` as Href)} style={styles.add} /> : null}
      <Select label="Class" value={classId} onChange={setClassId}
        options={[{ value: ALL, label: classOptions ? 'All my classes' : 'All classes' }, ...options.map((o) => ({ value: o.id, label: o.label }))]} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or roll number..." />
      {canAdd ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow}>
          {STATUS_SCOPES.map((o) => (
            <TouchableOpacity key={o.value} accessibilityRole="radio" accessibilityState={{ selected: scope === o.value }} onPress={() => setScope(o.value)}
              style={[styles.chip, scope === o.value && styles.chipOn]}>
              <Text style={[styles.chipText, scope === o.value && styles.chipTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {query.data ? <Text style={styles.count}>{total} student{total === 1 ? '' : 's'}</Text> : null}
      {renumberSection ? (
        <View style={styles.bulkRow}>
          <Button title="Re-number section" size="sm" variant="outline" onPress={() => setSheet('renumber')} />
        </View>
      ) : null}
      {canAdd ? (
        <View style={styles.bulkRow}>
          <Button title={selecting ? 'Done selecting' : 'Select'} size="sm" variant="outline" onPress={() => { setSelecting((v) => !v); setSelected([]); }} />
          {selecting ? <Button title={selectedAll(shownIds, selected) ? 'Clear page' : 'Select page'} size="sm" variant="ghost" onPress={() => setSelected((s) => toggleAll(shownIds, s))} /> : null}
        </View>
      ) : null}
      {canAdd && selecting ? (
        <View style={styles.bulkRow}>
          <Button title={`Create logins (${loginIds.length})`} size="sm" variant="outline" disabled={loginIds.length === 0} onPress={() => setSheet('accounts')} />
          <Button title={`Reports (${selected.length})`} size="sm" variant="outline" disabled={selected.length === 0} onPress={() => setSheet('reports')} />
        </View>
      ) : null}
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton variant="list" /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={students}
      keyExtractor={(s) => String(s.id)}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={<EmptyState title="No students" message={term ? 'No students match your search.' : 'No students found.'} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
      renderItem={({ item: s }) => (
        <View style={selecting ? styles.pickRow : undefined}>
          {selecting ? <Text accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(s.id) }} style={styles.check} onPress={() => setSelected((x) => toggleId(x, s.id))}>{selected.includes(s.id) ? '☑' : '☐'}</Text> : null}
          <View style={selecting ? styles.pickCard : undefined}>
        <RecordCard
          title={s.name}
          subtitle={`${s.roll_number ? `Roll ${s.roll_number}  ·  ` : ''}${s.class_name || ''}`}
          meta={s.parent_name ? `${s.parent_name}${s.parent_phone ? `  ·  ${s.parent_phone}` : ''}` : s.parent_phone || undefined}
          avatarName={s.name}
          avatarUri={s.photo_url}
          status={s.status && s.status !== 'ACTIVE' ? { label: statusLabel(s.status), tone: statusTone(s.status) } : undefined}
          onPress={() => (selecting ? setSelected((x) => toggleId(x, s.id)) : router.push(`${base}/students/${s.id}` as Href))}
        />
          </View>
        </View>
      )}
    />
      <BulkAccountsSheet visible={sheet === 'accounts'} onClose={() => setSheet(null)} ids={loginIds} skipped={selected.length - loginIds.length}
        onDone={() => { setSelected([]); setSelecting(false); }} />
      {renumberSection ? <RenumberSectionSheet visible={sheet === 'renumber'} onClose={() => setSheet(null)} section={renumberSection} /> : null}
      <BulkReportsSheet visible={sheet === 'reports'} onClose={() => setSheet(null)} students={picked} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  tile: { width: '48%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  tileValue: { fontSize: FontSize.xl, fontWeight: '700' },
  tileLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  add: { alignSelf: 'flex-end', marginBottom: Spacing.md },
  bulkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center' },
  pickCard: { flex: 1 },
  check: { fontSize: 24, color: Colors.primary, paddingRight: Spacing.sm, minWidth: 36, textAlign: 'center' },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.md },
  chips: { marginBottom: Spacing.md },
  chipsRow: { gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.textInverse },
});
