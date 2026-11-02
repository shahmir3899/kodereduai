import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { ClassOption } from '../../services/attendanceEntry';
import { STATUS_SCOPES, statusLabel, statusTone, type StatusScope } from '../../services/students';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useStudentsPaged } from '../../hooks/useStudents';
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

  const header = (
    <View>
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
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton variant="list" /></View>;
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
        <RecordCard
          title={s.name}
          subtitle={`${s.roll_number ? `Roll ${s.roll_number}  ·  ` : ''}${s.class_name || ''}`}
          meta={s.parent_name ? `${s.parent_name}${s.parent_phone ? `  ·  ${s.parent_phone}` : ''}` : s.parent_phone || undefined}
          avatarName={s.name}
          avatarUri={s.photo_url}
          status={s.status && s.status !== 'ACTIVE' ? { label: statusLabel(s.status), tone: statusTone(s.status) } : undefined}
          onPress={() => router.push(`${base}/students/${s.id}` as Href)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  add: { alignSelf: 'flex-end', marginBottom: Spacing.md },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.md },
  chips: { marginBottom: Spacing.md },
  chipsRow: { gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.textInverse },
});
