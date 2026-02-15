import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { transportApi } from '../../services/api';
import { parentsApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Child {
  id: number;
  student_id: number;
  name: string;
  class_name?: string;
}

interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number;
  battery_level?: number;
}

interface JourneyData {
  id: number;
  journey_type: string;
  status: string;
  started_at: string;
  student_name: string;
}

export default function TrackChild() {
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [active, setActive] = useState(false);
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [locations, setLocations] = useState<LocationPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch children
  useEffect(() => {
    const fetchChildren = async () => {
      try {
        const response = await parentsApi.getMyChildren();
        const data = response.data.results || response.data.children || response.data || [];
        setChildren(data);
        if (data.length > 0) setSelectedChild(data[0]);
      } catch (error) {
        console.error('Failed to fetch children:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchChildren();
  }, []);

  const fetchTracking = useCallback(async () => {
    if (!selectedChild) return;
    try {
      const response = await transportApi.trackStudent(selectedChild.student_id || selectedChild.id);
      const data = response.data;
      setActive(data.active);
      if (data.active) {
        setJourney(data.journey);
        setLocations(data.locations || []);
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setJourney(null);
        setLocations([]);
      }
    } catch (error) {
      console.error('Failed to track child:', error);
    }
    setRefreshing(false);
  }, [selectedChild]);

  // Poll every 10 seconds when active
  useEffect(() => {
    if (!selectedChild) return;
    fetchTracking();

    pollingRef.current = setInterval(fetchTracking, 10000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedChild, fetchTracking]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTracking();
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  const latestLoc = locations.length > 0 ? locations[0] : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Track Child</Text>

      {/* Child selector */}
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          <View style={styles.chipRow}>
            {children.map((child) => (
              <Button
                key={child.id}
                title={child.name}
                size="sm"
                variant={selectedChild?.id === child.id ? 'primary' : 'outline'}
                onPress={() => setSelectedChild(child)}
              />
            ))}
          </View>
        </ScrollView>
      )}

      {!active ? (
        <EmptyState
          title="No Active Journey"
          message={`${selectedChild?.name || 'Your child'} is not currently sharing their location.`}
        />
      ) : (
        <View>
          {/* Journey info */}
          <Card style={styles.journeyCard}>
            <View style={styles.journeyHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.childName}>{journey?.student_name || selectedChild?.name}</Text>
                <Text style={styles.journeyType}>
                  {journey?.journey_type === 'TO_SCHOOL' ? 'Going to School' : 'Going Home'}
                </Text>
              </View>
              <Badge label="LIVE" variant="success" />
            </View>
            {journey?.started_at && (
              <Text style={styles.startedAt}>
                Started: {new Date(journey.started_at).toLocaleTimeString()}
              </Text>
            )}
          </Card>

          {/* Location details */}
          {latestLoc && (
            <Card style={styles.locationCard}>
              <Text style={styles.sectionTitle}>Latest Position</Text>
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Lat:</Text>
                <Text style={styles.coordValue}>{Number(latestLoc.latitude).toFixed(6)}</Text>
              </View>
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Lng:</Text>
                <Text style={styles.coordValue}>{Number(latestLoc.longitude).toFixed(6)}</Text>
              </View>
              {latestLoc.speed != null && latestLoc.speed > 0 && (
                <View style={styles.coordRow}>
                  <Text style={styles.coordLabel}>Speed:</Text>
                  <Text style={styles.coordValue}>{(latestLoc.speed * 3.6).toFixed(1)} km/h</Text>
                </View>
              )}
              {latestLoc.battery_level != null && (
                <View style={styles.coordRow}>
                  <Text style={styles.coordLabel}>Battery:</Text>
                  <Text style={styles.coordValue}>{latestLoc.battery_level}%</Text>
                </View>
              )}
              <Text style={styles.updatedAt}>Last updated: {lastUpdated}</Text>
            </Card>
          )}

          {/* Location history */}
          <Text style={styles.sectionTitle}>Recent Updates ({locations.length})</Text>
          {locations.slice(0, 10).map((loc, idx) => (
            <Card key={idx} style={styles.historyItem}>
              <View style={styles.historyRow}>
                <Text style={styles.historyCoord}>
                  ({Number(loc.latitude).toFixed(4)}, {Number(loc.longitude).toFixed(4)})
                </Text>
                <Text style={styles.historyTime}>
                  {new Date(loc.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            </Card>
          ))}
        </View>
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
  journeyCard: { marginBottom: Spacing.md },
  journeyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  childName: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  journeyType: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  startedAt: { fontSize: FontSize.xs, color: Colors.textTertiary },
  locationCard: { marginBottom: Spacing.md },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginBottom: Spacing.sm },
  coordRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  coordLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  coordValue: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  updatedAt: { fontSize: FontSize.xs, color: Colors.primary, marginTop: Spacing.sm, textAlign: 'right' },
  historyItem: { marginBottom: Spacing.xs },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyCoord: { fontSize: FontSize.xs, color: Colors.text, fontFamily: 'monospace' },
  historyTime: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
