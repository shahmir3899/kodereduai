import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { hostelApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

interface GatePass {
  id: number;
  student_name: string;
  reason: string;
  leave_date: string;
  return_date: string;
  status: string;
  created_at: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', CHECKED_OUT: 'info', RETURNED: 'success',
};

export default function GatePasses() {
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<number | null>(null);

  const fetchPasses = async () => {
    try {
      const response = await hostelApi.getGatePasses();
      setPasses(response.data.results || response.data || []);
    } catch (error) { console.error('Failed to fetch gate passes:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchPasses(); }, []);
  const onRefresh = () => { setRefreshing(true); fetchPasses(); };

  const handleAction = async (id: number, action: string) => {
    setProcessing(id);
    try {
      if (action === 'approve') await hostelApi.approveGatePass(id);
      else if (action === 'reject') await hostelApi.rejectGatePass(id);
      else if (action === 'checkout') await hostelApi.checkoutGatePass(id);
      else if (action === 'return') await hostelApi.returnGatePass(id);
      Alert.alert('Success', `Gate pass ${action}ed successfully.`);
      fetchPasses();
    } catch (error) {
      console.error(`Failed to ${action} gate pass:`, error);
      Alert.alert('Error', `Failed to ${action} gate pass.`);
    } finally { setProcessing(null); }
  };

  if (loading) return <Spinner fullScreen message="Loading gate passes..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Gate Passes</Text>
      {passes.length === 0 ? (
        <EmptyState title="No Gate Passes" message="No gate pass requests found." />
      ) : (
        passes.map((pass) => (
          <Card key={pass.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.studentName}>{pass.student_name}</Text>
              <Badge label={pass.status} variant={STATUS_VARIANTS[pass.status] || 'default'} />
            </View>
            <Text style={styles.dates}>{pass.leave_date} to {pass.return_date}</Text>
            <Text style={styles.reason}>{pass.reason}</Text>
            <View style={styles.actions}>
              {pass.status === 'PENDING' && (
                <>
                  <Button title="Reject" variant="danger" size="sm" onPress={() => handleAction(pass.id, 'reject')} loading={processing === pass.id} style={{ flex: 1 }} />
                  <Button title="Approve" size="sm" onPress={() => handleAction(pass.id, 'approve')} loading={processing === pass.id} style={{ flex: 1 }} />
                </>
              )}
              {pass.status === 'APPROVED' && (
                <Button title="Check Out" variant="secondary" size="sm" onPress={() => handleAction(pass.id, 'checkout')} loading={processing === pass.id} style={{ flex: 1 }} />
              )}
              {pass.status === 'CHECKED_OUT' && (
                <Button title="Mark Returned" size="sm" onPress={() => handleAction(pass.id, 'return')} loading={processing === pass.id} style={{ flex: 1 }} />
              )}
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  card: { marginBottom: Spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  studentName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  dates: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500', marginBottom: Spacing.sm },
  reason: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
});
