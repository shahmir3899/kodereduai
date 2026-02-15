import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { academicsApi, classesApi } from '../../services/api';
import TimetableGrid from '../../components/TimetableGrid';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface ClassItem { id: number; name: string; }
interface TimetableEntry { day: string; slot_name?: string; start_time: string; end_time: string; subject_name: string; teacher_name?: string; }

export default function Timetable() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const response = await classesApi.getClasses();
        const data = response.data.results || response.data || [];
        setClasses(data);
        if (data.length > 0) setSelectedClass(data[0].id);
      } catch (error) { console.error('Failed to fetch classes:', error); }
      finally { setLoading(false); }
    };
    fetchClasses();
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    const fetchTimetable = async () => {
      try {
        const response = await academicsApi.getTimetableByClass(selectedClass);
        setEntries(response.data.entries || response.data.timetable || response.data || []);
      } catch (error) { console.error('Failed to fetch timetable:', error); }
      finally { setRefreshing(false); }
    };
    fetchTimetable();
  }, [selectedClass]);

  const onRefresh = () => { setRefreshing(true); };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Timetable</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        <View style={styles.chipRow}>
          {classes.map((cls) => (
            <TouchableOpacity key={cls.id}
              style={[styles.chip, selectedClass === cls.id && styles.chipSelected]}
              onPress={() => setSelectedClass(cls.id)}>
              <Text style={[styles.chipText, selectedClass === cls.id && styles.chipTextSelected]}>
                {cls.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      {entries.length === 0 ? (
        <EmptyState title="No Timetable" message="No timetable entries for this class." />
      ) : (
        <TimetableGrid entries={entries} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  chipScroll: { marginBottom: Spacing.lg },
  chipRow: { flexDirection: 'row', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text },
  chipTextSelected: { color: Colors.textInverse, fontWeight: '600' },
});
