import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hostelApi } from '../../../services/api';
import { useScopedQuery } from '../../../hooks/useScopedQuery';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { saveFailureMessage } from '../../../services/errorKind';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import QueryBoundary from '../../../components/ui/QueryBoundary';
import { useToast } from '../../../components/ui/Toast';
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

type Action = 'approve' | 'reject' | 'checkout' | 'return';
const ACTIONS: Record<Action, (id: number) => Promise<unknown>> = {
  approve: (id) => hostelApi.approveGatePass(id),
  reject: (id) => hostelApi.rejectGatePass(id),
  checkout: (id) => hostelApi.checkoutGatePass(id),
  return: (id) => hostelApi.returnGatePass(id),
};
const DONE: Record<Action, string> = { approve: 'approved', reject: 'rejected', checkout: 'checked out', return: 'marked returned' };

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', CHECKED_OUT: 'info', RETURNED: 'success',
};

export default function GatePasses() {
  const toast = useToast();
  const qc = useQueryClient();
  const query = useScopedQuery<GatePass[]>('hostel-gate-passes', [], async () => {
    const r = await hostelApi.getGatePasses();
    return r.data.results || r.data || [];
  });
  const refreshControl = useRefreshControl(query.refetch);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: Action }) => ACTIONS[action](id),
    onSuccess: (_d, { action }) => {
      toast.success(`Gate pass ${DONE[action]}.`);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'hostel-gate-passes' });
    },
    onError: (e, { action }) => toast.error(saveFailureMessage(e, `Could not ${action} the gate pass.`)),
  });
  const busy = (id: number) => act.isPending && act.variables?.id === id;
  const run = (id: number, action: Action) => act.mutate({ id, action });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.title}>Gate Passes</Text>
      <QueryBoundary query={query} emptyTitle="No Gate Passes" emptyMessage="No gate pass requests found.">
        {(passes) => passes.map((pass) => (
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
                  <Button title="Reject" variant="danger" size="sm" onPress={() => run(pass.id, 'reject')} loading={busy(pass.id)} style={{ flex: 1 }} />
                  <Button title="Approve" size="sm" onPress={() => run(pass.id, 'approve')} loading={busy(pass.id)} style={{ flex: 1 }} />
                </>
              )}
              {pass.status === 'APPROVED' && (
                <Button title="Check Out" variant="secondary" size="sm" onPress={() => run(pass.id, 'checkout')} loading={busy(pass.id)} style={{ flex: 1 }} />
              )}
              {pass.status === 'CHECKED_OUT' && (
                <Button title="Mark Returned" size="sm" onPress={() => run(pass.id, 'return')} loading={busy(pass.id)} style={{ flex: 1 }} />
              )}
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  studentName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  dates: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500', marginBottom: Spacing.sm },
  reason: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
});
