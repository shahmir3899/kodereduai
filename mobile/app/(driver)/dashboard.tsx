import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { transportApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import {
  requestLocationPermissions,
  getCurrentLocation,
  startBackgroundLocationUpdates,
} from '../../services/location';

interface Vehicle {
  id: number;
  vehicle_number: string;
  vehicle_type: string;
  capacity: number;
  assigned_route: number | null;
  assigned_route_name?: string;
  driver_name?: string;
}

interface Stop {
  id: number;
  name: string;
  address: string;
  stop_order: number;
  pickup_time: string | null;
  drop_time: string | null;
}

interface RouteInfo {
  id: number;
  name: string;
  start_location: string;
  end_location: string;
  distance_km: string | null;
  estimated_duration_minutes: number | null;
}

export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [journeyType, setJourneyType] = useState<'TO_SCHOOL' | 'FROM_SCHOOL'>('TO_SCHOOL');

  const fetchData = useCallback(async () => {
    try {
      // Get assigned vehicle
      const vehicleRes = await transportApi.getMyVehicle();
      const vehicleData = vehicleRes.data;
      setVehicle(vehicleData);

      // Get route details if vehicle has an assigned route
      if (vehicleData.assigned_route) {
        const routesRes = await transportApi.getRoutes({ page_size: 9999 });
        const routes = routesRes.data?.results || routesRes.data || [];
        const assignedRoute = routes.find((r: RouteInfo) => r.id === vehicleData.assigned_route);
        if (assignedRoute) {
          setRoute(assignedRoute);
        }

        // Get stops for the route
        const stopsRes = await transportApi.getStops({ route: vehicleData.assigned_route, page_size: 9999 });
        const stopsArr = stopsRes.data?.results || stopsRes.data || [];
        setStops(stopsArr.sort((a: Stop, b: Stop) => (a.stop_order || 0) - (b.stop_order || 0)));
      }
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        // No vehicle assigned — that's ok
        setVehicle(null);
      } else {
        console.error('Failed to load driver data:', error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStartJourney = async () => {
    if (!vehicle?.assigned_route) {
      Alert.alert('No Route', 'Your vehicle does not have an assigned route.');
      return;
    }

    setStarting(true);
    try {
      const hasPermission = await requestLocationPermissions();
      if (!hasPermission) {
        Alert.alert('Permission Required', 'Location permission is needed to start the route journey.');
        return;
      }

      const location = await getCurrentLocation();
      if (!location) {
        Alert.alert('Error', 'Could not get your current location. Please try again.');
        return;
      }

      const response = await transportApi.startRouteJourney({
        journey_type: journeyType,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const journey = response.data;
      await startBackgroundLocationUpdates(journey.id, 'route', 'Bus location is being tracked.');

      router.push({
        pathname: '/(driver)/journey',
        params: {
          journeyId: journey.id,
          journeyType: journey.journey_type,
          routeName: route?.name || 'Route',
          startedAt: journey.started_at,
        },
      });
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to start journey.';
      Alert.alert('Error', msg);
    } finally {
      setStarting(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => logout() },
    ]);
  };

  if (loading) {
    return <Spinner fullScreen message="Loading driver info..." />;
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
    >
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Hello, {user?.first_name || user?.username || 'Driver'}</Text>
          <Button title="Logout" onPress={handleLogout} variant="outline" style={styles.logoutBtn} />
        </View>

        {/* Vehicle Info */}
        {vehicle ? (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>My Vehicle</Text>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Number</Text>
              <Text style={styles.value}>{vehicle.vehicle_number}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Type</Text>
              <Text style={styles.value}>{vehicle.vehicle_type}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Capacity</Text>
              <Text style={styles.value}>{vehicle.capacity} seats</Text>
            </View>
            {route && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Route</Text>
                <Text style={styles.value}>{route.name}</Text>
              </View>
            )}
          </Card>
        ) : (
          <Card style={styles.card}>
            <Text style={styles.noVehicle}>No vehicle assigned to your account.</Text>
            <Text style={styles.hint}>Please contact your school administrator to assign a vehicle.</Text>
          </Card>
        )}

        {/* Route Details */}
        {route && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Route: {route.name}</Text>
            <View style={styles.infoRow}>
              <Text style={styles.label}>From</Text>
              <Text style={styles.value}>{route.start_location || '--'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>To</Text>
              <Text style={styles.value}>{route.end_location || '--'}</Text>
            </View>
            {route.distance_km && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Distance</Text>
                <Text style={styles.value}>{route.distance_km} km</Text>
              </View>
            )}
            {route.estimated_duration_minutes && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Est. Duration</Text>
                <Text style={styles.value}>{route.estimated_duration_minutes} min</Text>
              </View>
            )}
          </Card>
        )}

        {/* Stops */}
        {stops.length > 0 && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Stops ({stops.length})</Text>
            {stops.map((stop, index) => (
              <View key={stop.id} style={[styles.stopItem, index < stops.length - 1 && styles.stopBorder]}>
                <View style={styles.stopNumber}>
                  <Text style={styles.stopNumberText}>{stop.stop_order}</Text>
                </View>
                <View style={styles.stopDetails}>
                  <Text style={styles.stopName}>{stop.name}</Text>
                  {stop.address ? <Text style={styles.stopAddress}>{stop.address}</Text> : null}
                  <View style={styles.stopTimes}>
                    <Text style={styles.stopTime}>Pickup: {stop.pickup_time || '--'}</Text>
                    <Text style={styles.stopTime}>Drop: {stop.drop_time || '--'}</Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* Start Journey */}
        {vehicle?.assigned_route && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Start Route Journey</Text>

            <View style={styles.typeSelector}>
              <Button
                title="To School"
                onPress={() => setJourneyType('TO_SCHOOL')}
                variant={journeyType === 'TO_SCHOOL' ? 'primary' : 'outline'}
                style={styles.typeBtn}
              />
              <Button
                title="From School"
                onPress={() => setJourneyType('FROM_SCHOOL')}
                variant={journeyType === 'FROM_SCHOOL' ? 'primary' : 'outline'}
                style={styles.typeBtn}
              />
            </View>

            <Button
              title={starting ? 'Starting...' : 'Start Journey'}
              onPress={handleStartJourney}
              loading={starting}
              style={styles.startBtn}
            />
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  logoutBtn: { paddingHorizontal: Spacing.md },
  card: { padding: Spacing.lg, marginBottom: Spacing.lg },
  cardTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  value: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  noVehicle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textTertiary, textAlign: 'center' },
  stopItem: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.sm },
  stopBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  stopNumber: {
    width: 28, height: 28, borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: Spacing.md,
  },
  stopNumberText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textInverse },
  stopDetails: { flex: 1 },
  stopName: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  stopAddress: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  stopTimes: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.xs },
  stopTime: { fontSize: FontSize.xs, color: Colors.textTertiary },
  typeSelector: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  typeBtn: { flex: 1 },
  startBtn: { marginTop: Spacing.sm },
});
