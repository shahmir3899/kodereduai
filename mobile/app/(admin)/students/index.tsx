import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { studentsApi, classesApi } from '../../../services/api';
import StudentCard from '../../../components/StudentCard';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Student {
  id: number;
  name: string;
  class_name: string;
  roll_number: string;
  profile_photo_url?: string | null;
}

export default function StudentDirectory() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchStudents = async () => {
    try {
      const params: Record<string, unknown> = { page_size: 100 };
      if (search.trim()) params.search = search.trim();
      const response = await studentsApi.getStudents(params);
      const data = response.data;
      setStudents(data.results || data || []);
    } catch (error) {
      console.error('Failed to fetch students:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchStudents(), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStudents();
  };

  if (loading) return <Spinner fullScreen message="Loading students..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Students</Text>

      {/* Search */}
      <TextInput
        style={styles.searchInput}
        placeholder="Search by name or roll number..."
        placeholderTextColor={Colors.placeholder}
        value={search}
        onChangeText={setSearch}
      />

      <Text style={styles.countText}>{students.length} students</Text>

      {students.length === 0 ? (
        <EmptyState title="No Students" message={search ? 'No students match your search.' : 'No students found.'} />
      ) : (
        students.map((student) => (
          <StudentCard
            key={student.id}
            id={student.id}
            name={student.name}
            class_name={student.class_name}
            roll_number={student.roll_number}
            onPress={(id) => router.push(`/(admin)/students/${id}`)}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  searchInput: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md },
  countText: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.md },
});
