import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { ClassOption } from '../../services/attendanceEntry';
import { statusLabel, statusTone } from '../../services/students';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useStudentsPaged } from '../../hooks/useStudents';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Avatar from '../ui/Avatar';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ALL = 0;

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
}

// Students the role may see, with search and a class filter. Read-only: details open the profile.
export default function StudentsListScreen({ classOptions }: Props) {
  const router = useRouter();
  const base = usePersonaBase();
  const { class: classParam } = useLocalSearchParams<{ class?: string }>();
  const { options } = useAttendanceClassOptions(classOptions);
  const [classId, setClassId] = useState<number>(ALL);
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);

  // Opened from the Classes screen: start on that section.
  useEffect(() => {
    const wanted = classParam ? Number(classParam) : null;
    if (wanted && options.some((o) => o.id === wanted)) setClassId(wanted);
  }, [classParam, options]);

  const option = classId === ALL ? null : options.find((o) => o.id === classId) ?? null;
  const query = useStudentsPaged(term, option);
  const refreshControl = useRefreshControl(query.refetch);
  const students = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const total = query.data?.pages[0]?.count ?? 0;

  const header = (
    <View>
      <Select label="Class" value={classId} onChange={setClassId}
        options={[{ value: ALL, label: classOptions ? 'All my classes' : 'All classes' }, ...options.map((o) => ({ value: o.id, label: o.label }))]} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or roll number..." />
      {query.data ? <Text style={styles.count}>{total} student{total === 1 ? '' : 's'}</Text> : null}
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
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
        <TouchableOpacity style={styles.row} onPress={() => router.push(`${base}/students/${s.id}` as Href)}>
          <Avatar name={s.name} uri={s.photo_url} />
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{s.roll_number ? `Roll ${s.roll_number}  ·  ` : ''}{s.class_name || ''}</Text>
          </View>
          {s.status && s.status !== 'ACTIVE' ? <StatusPill label={statusLabel(s.status)} tone={statusTone(s.status)} /> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
