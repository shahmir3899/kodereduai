import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { studentPortalApi } from '../../services/api';
import TimetableGrid from '../../components/TimetableGrid';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface TimetableEntry {
  day: string;
  slot_name?: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_name?: string;
}

export default function MyTimetable() {
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTimetable = async () => {
    try {
      const response = await studentPortalApi.getTimetable();
      const data = response.data;
      setEntries(data.entries || data.timetable || data || []);
    } catch (error) {
      console.error('Failed to fetch timetable:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTimetable();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTimetable();
  };

  if (loading) return <Spinner fullScreen message="Loading timetable..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>My Timetable</Text>
      {entries.length === 0 ? (
        <EmptyState title="No Timetable" message="No timetable has been set up yet." />
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
});
