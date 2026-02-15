import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { parentsApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface LeaveRequest {
  id: number;
  student_name: string;
  parent_name?: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  created_at: string;
}

export default function LeaveApprovals() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<number | null>(null);

  const fetchRequests = async () => {
    try {
      const response = await parentsApi.getAdminLeaveRequests({ status: 'PENDING' });
      setRequests(response.data.results || response.data || []);
    } catch (error) { console.error('Failed to fetch leave requests:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchRequests(); }, []);
  const onRefresh = () => { setRefreshing(true); fetchRequests(); };

  const handleReview = async (id: number, action: 'APPROVED' | 'REJECTED') => {
    setProcessing(id);
    try {
      await parentsApi.reviewLeaveRequest(id, { status: action });
      Alert.alert('Success', `Leave request ${action.toLowerCase()}.`);
      fetchRequests();
    } catch (error) {
      console.error('Failed to review leave:', error);
      Alert.alert('Error', 'Failed to process leave request.');
    } finally { setProcessing(null); }
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Leave Approvals</Text>
      {requests.length === 0 ? (
        <EmptyState title="No Pending Requests" message="All leave requests have been processed." />
      ) : (
        requests.map((req) => (
          <Card key={req.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.studentName}>{req.student_name}</Text>
                {req.parent_name && <Text style={styles.parentName}>By: {req.parent_name}</Text>}
              </View>
              <Badge label={req.leave_type} variant="info" />
            </View>
            <Text style={styles.dates}>{req.start_date} to {req.end_date}</Text>
            <Text style={styles.reason}>{req.reason}</Text>
            <View style={styles.actions}>
              <Button title="Reject" variant="danger" size="sm" onPress={() => handleReview(req.id, 'REJECTED')}
                loading={processing === req.id} style={{ flex: 1 }} />
              <Button title="Approve" size="sm" onPress={() => handleReview(req.id, 'APPROVED')}
                loading={processing === req.id} style={{ flex: 1 }} />
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.sm },
  studentName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  parentName: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  dates: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500', marginBottom: Spacing.sm },
  reason: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
});
