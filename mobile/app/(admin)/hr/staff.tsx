import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TextInput } from 'react-native';
import { hrApi } from '../../../services/api';
import StaffCard from '../../../components/StaffCard';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Staff {
  id: number;
  name: string;
  department?: string;
  designation?: string;
  phone?: string;
}

export default function StaffDirectory() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchStaff = async () => {
    try {
      const params: Record<string, unknown> = {};
      if (search.trim()) params.search = search.trim();
      const response = await hrApi.getStaff(params);
      setStaff(response.data.results || response.data || []);
    } catch (error) {
      console.error('Failed to fetch staff:', error);
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchStaff(); }, []);
  useEffect(() => { const t = setTimeout(fetchStaff, 400); return () => clearTimeout(t); }, [search]);
  const onRefresh = () => { setRefreshing(true); fetchStaff(); };

  if (loading) return <Spinner fullScreen message="Loading staff..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Staff Directory</Text>
      <TextInput style={styles.search} placeholder="Search staff..." placeholderTextColor={Colors.placeholder}
        value={search} onChangeText={setSearch} />
      {staff.length === 0 ? (
        <EmptyState title="No Staff" message={search ? 'No staff match your search.' : 'No staff records found.'} />
      ) : (
        staff.map((s) => <StaffCard key={s.id} id={s.id} name={s.name} department={s.department} designation={s.designation} phone={s.phone} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  search: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md },
});
