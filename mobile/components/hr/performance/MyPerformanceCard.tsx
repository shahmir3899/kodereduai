import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Card from '../../ui/Card';
import StatusPill from '../../ui/StatusPill';
import PerformanceInfoButton from './PerformanceInfoButton';
import { useMyPerformance } from '../../../hooks/useTeacherPerformance';
import { bandTone, formatScore, monthRange, positionText } from '../../../services/teacherPerformance';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

// "My performance" on the teacher home screen. Hidden when the teacher is not on the report or the
// school has not turned it on for teachers.
export default function MyPerformanceCard() {
  const router = useRouter();
  const range = monthRange(0);
  const q = useMyPerformance(range);
  if (q.isError || q.data?.enabled === false) return null;
  const t = q.data?.teacher;
  const position = t ? positionText(t.rank, q.data?.out_of) : '';

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.rowGap}>
          <Text style={styles.title} accessibilityRole="header">My performance</Text>
          {t ? <PerformanceInfoButton wins={t.quickest_wins} /> : null}
        </View>
        <TouchableOpacity onPress={() => router.push('/(teacher)/my-performance' as Href)} accessibilityRole="link">
          <Text style={styles.link}>Details</Text>
        </TouchableOpacity>
      </View>
      {!t ? (
        <Text style={styles.muted}>{q.isLoading ? 'Working out this month…' : ''}</Text>
      ) : (
        <>
          <View style={styles.rowGap}>
            <Text style={styles.score}>{formatScore(t.overall_score)}</Text>
            <View style={{ gap: 2 }}>
              {t.band ? <StatusPill label={t.band.label} tone={bandTone(t.band)} /> : null}
              {position ? <Text style={styles.muted}>{position} this month</Text> : null}
            </View>
          </View>
          {t.quickest_wins.length > 0 && (
            <View style={{ marginTop: Spacing.sm }}>
              <Text style={styles.muted}>Quickest wins</Text>
              {t.quickest_wins.map((w) => (
                <Text key={w.key} style={styles.win}>{w.label} <Text style={styles.muted}>(+{w.points_available})</Text></Text>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  score: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.text },
  muted: { fontSize: FontSize.xs, color: Colors.textSecondary },
  win: { fontSize: FontSize.sm, color: Colors.text, marginTop: 2 },
});
