import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parentsApi } from '../../../services/api';
import { useScopedQuery } from '../../../hooks/useScopedQuery';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { saveFailureMessage } from '../../../services/errorKind';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import QueryBoundary from '../../../components/ui/QueryBoundary';
import { useToast } from '../../../components/ui/Toast';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

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
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const query = useScopedQuery<LeaveRequest[]>('admin-leave-requests', ['PENDING'], async () => {
    const r = await parentsApi.getAdminLeaveRequests({ status: 'PENDING' });
    return r.data.results || r.data || [];
  });
  const refreshControl = useRefreshControl(query.refetch);

  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'APPROVED' | 'REJECTED' }) => parentsApi.reviewLeaveRequest(id, { status }),
    onSuccess: (_d, { status }) => {
      toast.success(`Leave request ${status.toLowerCase()}.`);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'admin-leave-requests' });
    },
    onError: (e) => toast.error(saveFailureMessage(e, 'Could not process the leave request.')),
  });
  const busy = (id: number) => review.isPending && review.variables?.id === id;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.title}>Leave Approvals</Text>
      <Button title="Leave policies" size="sm" variant="outline" style={{ marginBottom: Spacing.md }} onPress={() => router.push('/(admin)/hr/leave-policies' as Href)} />
      <QueryBoundary query={query} emptyTitle="No Pending Requests" emptyMessage="All leave requests have been processed.">
        {(requests) => requests.map((req) => (
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
              <Button title="Reject" variant="danger" size="sm" onPress={() => review.mutate({ id: req.id, status: 'REJECTED' })}
                loading={busy(req.id)} style={{ flex: 1 }} />
              <Button title="Approve" size="sm" onPress={() => review.mutate({ id: req.id, status: 'APPROVED' })}
                loading={busy(req.id)} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}
      </QueryBoundary>
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
