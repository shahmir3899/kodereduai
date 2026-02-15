import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { transportApi } from '../../services/api';
import {
  requestLocationPermissions,
  getCurrentLocation,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '../../services/location';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Journey {
  id: number;
  journey_type: string;
  status: string;
  started_at: string;
  ended_at?: string;
  start_latitude: number;
  start_longitude: number;
}

export default function LocationSharing() {
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState('');

  const checkActiveJourney = useCallback(async () => {
    // We don't have a dedicated "my active journey" endpoint, so we start fresh
    // Active journey state is maintained locally during the session
  }, []);

  useEffect(() => {
    checkActiveJourney();
  }, [checkActiveJourney]);

  // Elapsed time ticker
  useEffect(() => {
    if (!activeJourney) {
      setElapsed('');
      return;
    }

    const startTime = new Date(activeJourney.started_at).getTime();
    const tick = () => {
      const diff = Date.now() - startTime;
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setElapsed(`${mins}m ${secs}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeJourney]);

  const startJourney = async (journeyType: 'TO_SCHOOL' | 'FROM_SCHOOL') => {
    setLoading(true);
    try {
      const hasPermission = await requestLocationPermissions();
      if (!hasPermission) {
        Alert.alert('Permission Required', 'Location permission is needed to share your journey.');
        return;
      }

      const location = await getCurrentLocation();
      if (!location) {
        Alert.alert('Error', 'Could not get your current location.');
        return;
      }

      const response = await transportApi.startJourney({
        journey_type: journeyType,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const journey = response.data;
      setActiveJourney(journey);
      await startBackgroundLocationUpdates(journey.id);
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to start journey.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const endJourney = async () => {
    if (!activeJourney) return;
    setLoading(true);
    try {
      const location = await getCurrentLocation();
      await transportApi.endJourney({
        journey_id: activeJourney.id,
        latitude: location?.coords.latitude,
        longitude: location?.coords.longitude,
      });
      await stopBackgroundLocationUpdates();
      setActiveJourney(null);
      Alert.alert('Journey Ended', 'Your location sharing has stopped.');
    } catch {
      Alert.alert('Error', 'Failed to end journey.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Location Sharing</Text>
        <Text style={styles.subtitle}>
          Share your journey with your parents so they can track you in real-time.
        </Text>

        {activeJourney ? (
          <Card style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <Badge
                label={activeJourney.journey_type === 'TO_SCHOOL' ? 'To School' : 'From School'}
                variant="info"
              />
              <Badge label="LIVE" variant="success" />
            </View>
            <Text style={styles.elapsedLabel}>Journey Duration</Text>
            <Text style={styles.elapsed}>{elapsed}</Text>
            <Text style={styles.hint}>
              Your location is being shared with your parents every 30 seconds.
            </Text>
            <Button
              title="End Journey"
              onPress={endJourney}
              loading={loading}
              variant="outline"
              style={styles.endBtn}
            />
          </Card>
        ) : (
          <View style={styles.startSection}>
            <Text style={styles.startLabel}>Start a Journey</Text>
            <Button
              title="Going to School"
              onPress={() => startJourney('TO_SCHOOL')}
              loading={loading}
              style={styles.journeyBtn}
            />
            <Button
              title="Going Home"
              onPress={() => startJourney('FROM_SCHOOL')}
              loading={loading}
              variant="outline"
              style={styles.journeyBtn}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xl },
  activeCard: { padding: Spacing.lg },
  activeHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.lg },
  elapsedLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  elapsed: { fontSize: 36, fontWeight: '700', color: Colors.primary, textAlign: 'center', marginVertical: Spacing.md },
  hint: { fontSize: FontSize.xs, color: Colors.textTertiary, textAlign: 'center', marginBottom: Spacing.lg },
  endBtn: { marginTop: Spacing.md },
  startSection: { marginTop: Spacing.lg },
  startLabel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },
  journeyBtn: { marginBottom: Spacing.md },
});
