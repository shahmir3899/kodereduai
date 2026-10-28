import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useStudentProfile } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const Row = ({ label, value }: { label: string; value?: string | number | null }) =>
  value ? (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{String(value)}</Text>
    </View>
  ) : null;

// The student's own record (read-only; changes go through the school office).
export default function StudentProfileScreen() {
  const query = useStudentProfile();
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const s = query.data;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(s.name || '?').charAt(0).toUpperCase()}</Text></View>
        <Text style={styles.name}>{s.name}</Text>
        <Text style={styles.sub}>{[s.class_name, s.roll_number ? `Roll #${s.roll_number}` : ''].filter(Boolean).join('  ·  ')}</Text>
        {s.school_name ? <Text style={styles.sub}>{s.school_name}</Text> : null}
      </View>

      <Card style={styles.card}>
        <Text style={styles.section}>Personal</Text>
        <Row label="Admission no." value={s.admission_number} />
        <Row label="Date of birth" value={s.date_of_birth} />
        <Row label="Gender" value={s.gender} />
        <Row label="Blood group" value={s.blood_group} />
        <Row label="Address" value={s.address} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Guardian</Text>
        <Row label="Name" value={s.guardian_name || s.parent_name} />
        <Row label="Relation" value={s.guardian_relation} />
        <Row label="Phone" value={s.guardian_phone || s.parent_phone} />
        <Row label="Emergency" value={s.emergency_contact} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  header: { alignItems: 'center', marginBottom: Spacing.lg },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textInverse },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 5 },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  value: { flex: 1, textAlign: 'right', fontSize: FontSize.sm, color: Colors.text },
});
