import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { sectionRows } from '../../services/students';
import { useAcademicYear, useSessionClasses } from '../../hooks/useAcademicYear';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Master classes a teacher is assigned to; admins leave it out and see every section.
  allowedMasterIds?: Set<number>;
  // Manager has no student-level data: the rows show counts only and do not open the roster.
  linkStudents?: boolean;
  // Admin and principal: adds the way into class setup (add, edit, delete, sections).
  canManage?: boolean;
}

// The year's sections with their student counts; admin and principal can open class setup from it.
export default function ClassesScreen({ allowedMasterIds, linkStudents = true, canManage = false }: Props) {
  const router = useRouter();
  const base = usePersonaBase();
  const year = useAcademicYear();
  const sessions = useSessionClasses(year.current?.id);
  const refreshControl = useRefreshControl(sessions.refetch);
  const rows = useMemo(() => sectionRows((sessions.data ?? []) as never[], allowedMasterIds ?? null), [sessions.data, allowedMasterIds]);

  if (year.isLoading || sessions.isLoading) return <Skeleton />;
  if (!year.current) return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;
  if (sessions.isError && !sessions.data) return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(r) => String(r.id)}
      refreshControl={refreshControl}
      ListHeaderComponent={(
        <View>
          <Text style={styles.year}>{year.current.name}</Text>
          {canManage ? <Button title="Add and edit classes" size="sm" variant="outline" style={{ marginBottom: Spacing.md }} onPress={() => router.push('/(admin)/class-setup' as Href)} /> : null}
        </View>
      )}
      ListEmptyComponent={<EmptyState title="No classes" message="There are no classes to show for this year." />}
      renderItem={({ item: r }) => (
        <TouchableOpacity accessibilityRole="button" style={styles.row} disabled={!linkStudents}
          onPress={() => router.push({ pathname: `${base}/students`, params: { class: r.id } } as Href)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{r.label}</Text>
            <Text style={styles.sub}>{r.students} student{r.students === 1 ? '' : 's'}</Text>
          </View>
          {linkStudents ? <Text style={styles.arrow}>›</Text> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  year: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
