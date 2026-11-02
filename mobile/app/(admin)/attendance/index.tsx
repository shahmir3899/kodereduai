import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { routeFor } from '../../../navigation/routes';
import Card from '../../../components/ui/Card';
import Icon, { type IconName } from '../../../components/ui/Icon';
import { useAttendanceHubStats } from '../../../hooks/useAnomalies';
import { hubLine } from '../../../services/anomalies';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

// Hub for the attendance tab. Register-photo capture/review (OCR) is parked and not listed.
export default function AttendanceHub() {
  const router = useRouter();
  const { isModuleEnabled } = useAuth();
  const stats = useAttendanceHubStats();
  if (!isModuleEnabled('attendance')) return null;

  const items: Array<{ title: string; body: string; route?: string; icon: IconName; note?: string | null }> = [
    { title: 'Mark attendance', icon: 'checkmark-done-outline', note: hubLine.today(stats.day.data), body: 'Mark each student present, absent or on leave for a class and day.', route: routeFor('admin', '/attendance/manual-entry') },
    { title: 'Attendance record', icon: 'calendar-outline', body: 'See a class month by month, and each student day by day.', route: routeFor('admin', '/attendance/register') },
    { title: 'Face attendance', icon: 'camera-outline', body: 'Take a class photo and review the matched students.', route: routeFor('admin', '/face-attendance') },
    { title: 'Anomalies', icon: 'warning-outline', note: hubLine.anomalies(stats.open.data), body: 'Unusual patterns the system found: review and resolve them.', route: '/(admin)/attendance/anomalies' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {items.map((it) => (
        <TouchableOpacity accessibilityRole="button" key={it.title} disabled={!it.route} onPress={() => it.route && router.push(it.route as Href)}>
          <Card style={styles.card}>
            <View style={styles.head}>
              <Icon name={it.icon} size={22} color={Colors.primary} />
              <Text style={styles.title}>{it.title}</Text>
            </View>
            {it.note ? <Text style={styles.note}>{it.note}</Text> : null}
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
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  note: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary, marginTop: Spacing.xs },
  title: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  body: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
});
