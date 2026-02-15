import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { studentPortalApi } from '../../services/api';
import FeeCard from '../../components/FeeCard';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface FeeRecord {
  id: number;
  month: number;
  year: number;
  amount: string;
  amount_paid: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  due_date?: string;
}

export default function MyFees() {
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFees = async () => {
    try {
      const response = await studentPortalApi.getFees();
      const data = response.data;
      setFees(data.fees || data.results || data || []);
    } catch (error) {
      console.error('Failed to fetch fees:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchFees();
  };

  if (loading) return <Spinner fullScreen message="Loading fees..." />;

  // Calculate summary
  const totalFees = fees.reduce((sum, f) => sum + parseFloat(f.amount), 0);
  const totalPaid = fees.reduce((sum, f) => sum + parseFloat(f.amount_paid), 0);
  const totalPending = totalFees - totalPaid;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>My Fees</Text>

      {/* Summary */}
      {fees.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total</Text>
              <Text style={styles.summaryValue}>PKR {totalFees.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Paid</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>
                PKR {totalPaid.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Pending</Text>
              <Text style={[styles.summaryValue, { color: totalPending > 0 ? Colors.error : Colors.success }]}>
                PKR {totalPending.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Fee List (read-only for students) */}
      {fees.length === 0 ? (
        <EmptyState
          title="No Fee Records"
          message="No fee records are available."
        />
      ) : (
        fees.map((fee) => (
          <FeeCard
            key={fee.id}
            id={fee.id}
            month={fee.month}
            year={fee.year}
            amount={fee.amount}
            amountPaid={fee.amount_paid}
            status={fee.status}
            dueDate={fee.due_date}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xxl,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
  summaryLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 4 },
  summaryValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
