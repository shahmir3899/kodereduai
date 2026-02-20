import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { transportApi } from '../../services/api';
import {
  getCurrentLocation,
  stopBackgroundLocationUpdates,
} from '../../services/location';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export default function ActiveJourney() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    journeyId: string;
    journeyType: string;
    routeName: string;
    startedAt: string;
  }>();

  const journeyId = parseInt(params.journeyId || '0');
  const journeyType = params.journeyType || 'TO_SCHOOL';
  const routeName = params.routeName || 'Route';
  const startedAt = params.startedAt || new Date().toISOString();

  const [elapsed, setElapsed] = useState('');
  const [ending, setEnding] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null);
  const [updateCount, setUpdateCount] = useState(0);

  // Elapsed time ticker
  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    const tick = () => {
      const diff = Date.now() - startTime;
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (hours > 0) {
        setElapsed(`${hours}h ${mins}m ${secs}s`);
      } else {
        setElapsed(`${mins}m ${secs}s`);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  // Periodic speed update from current location
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const location = await getCurrentLocation();
        if (location?.coords.speed != null && location.coords.speed >= 0) {
          setCurrentSpeed(Math.round(location.coords.speed * 3.6)); // m/s to km/h
        }
        setUpdateCount((prev) => prev + 1);
      } catch {
        // ignore
      }
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const handleEndJourney = useCallback(async () => {
    Alert.alert(
      'End Journey',
      'Are you sure you want to end this journey?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Journey',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            try {
              await transportApi.endRouteJourney({ journey_id: journeyId });
              await stopBackgroundLocationUpdates();
              Alert.alert('Journey Ended', 'The route journey has been completed.', [
                { text: 'OK', onPress: () => router.replace('/(driver)/dashboard') },
              ]);
            } catch (error: unknown) {
              const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to end journey.';
              Alert.alert('Error', msg);
            } finally {
              setEnding(false);
            }
          },
        },
      ]
    );
  }, [journeyId, router]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Journey Status */}
        <Card style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Badge
              label={journeyType === 'TO_SCHOOL' ? 'To School' : 'From School'}
              variant="info"
            />
            <Badge label="LIVE" variant="success" />
          </View>

          <Text style={styles.routeName}>{routeName}</Text>

          <Text style={styles.elapsedLabel}>Journey Duration</Text>
          <Text style={styles.elapsed}>{elapsed}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{currentSpeed != null ? `${currentSpeed}` : '--'}</Text>
              <Text style={styles.statLabel}>km/h</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{updateCount}</Text>
              <Text style={styles.statLabel}>Updates Sent</Text>
            </View>
          </View>

          <Text style={styles.hint}>
            Location is being sent to the server every 30 seconds.
            Parents will be notified as the bus approaches stops.
          </Text>
        </Card>

        {/* End Journey */}
        <Button
          title={ending ? 'Ending...' : 'End Journey'}
          onPress={handleEndJourney}
          loading={ending}
          variant="outline"
          style={styles.endBtn}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  statusCard: { padding: Spacing.xl, marginBottom: Spacing.xl },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.lg },
  routeName: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, textAlign: 'center', marginBottom: Spacing.xl },
  elapsedLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  elapsed: {
    fontSize: 42, fontWeight: '700', color: Colors.primary, textAlign: 'center',
    marginVertical: Spacing.lg,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.xl },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  statDivider: { width: 1, height: 40, backgroundColor: Colors.border },
  hint: {
    fontSize: FontSize.xs, color: Colors.textTertiary, textAlign: 'center',
    lineHeight: FontSize.xs * 1.5,
  },
  endBtn: { marginTop: Spacing.md, borderColor: Colors.error },
});
