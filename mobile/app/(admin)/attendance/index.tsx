import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { routeFor } from '../../../navigation/routes';
import Card from '../../../components/ui/Card';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

// Hub for the attendance tab. Register-photo capture/review (OCR) is parked and not listed.
export default function AttendanceHub() {
  const router = useRouter();
  const { isModuleEnabled } = useAuth();
  if (!isModuleEnabled('attendance')) return null;

  const items = [
    { title: 'Mark attendance', body: 'Mark each student present, absent or on leave for a class and day.', route: routeFor('admin', '/attendance/manual-entry') },
    { title: 'Attendance record', body: 'See a class month by month, and each student day by day.', route: routeFor('admin', '/attendance/register') },
    { title: 'Face attendance', body: 'Take a class photo and review the matched students.', route: routeFor('admin', '/face-attendance') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {items.map((it) => (
        <TouchableOpacity accessibilityRole="button" key={it.title} disabled={!it.route} onPress={() => it.route && router.push(it.route as Href)}>
          <Card style={styles.card}>
            <Text style={styles.title}>{it.title}</Text>
            <Text style={styles.body}>{it.body}</Text>
          </Card>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { padding: Spacing.lg, marginBottom: Spacing.md },
  title: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  body: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
});
