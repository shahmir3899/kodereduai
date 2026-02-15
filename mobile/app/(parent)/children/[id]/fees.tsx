import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parentsApi } from '../../../../services/api';
import FeeCard from '../../../../components/FeeCard';
import Spinner from '../../../../components/ui/Spinner';
import EmptyState from '../../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../../constants/colors';

interface FeeRecord {
  id: number;
  month: number;
  year: number;
  amount: string;
  amount_paid: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  due_date?: string;
}

interface FeeSummary {
  total_fees: number;
  total_paid: number;
  total_pending: number;
}

export default function ChildFees() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFees = async () => {
    try {
      const response = await parentsApi.getChildFees(Number(id));
      const data = response.data;
      setFees(data.fees || data.results || data || []);
      if (data.summary) setSummary(data.summary);
    } catch (error) {
      console.error('Failed to fetch fees:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchFees();
  };

  const handlePayNow = async (feeId: number) => {
    try {
      const response = await parentsApi.getPaymentGateways(Number(id));
      const gateways = response.data?.gateways || response.data || [];

      if (gateways.length === 0) {
        Alert.alert('No Payment Gateway', 'No payment gateways are configured. Please contact your school.');
        return;
      }

      // Navigate to payment screen with fee details
      router.push({
        pathname: '/(parent)/payment',
        params: {
          studentId: id,
          feeId: String(feeId),
          gateways: JSON.stringify(gateways),
        },
      });
    } catch (error) {
      console.error('Failed to get payment gateways:', error);
      Alert.alert('Error', 'Failed to load payment options. Please try again.');
    }
  };

  if (loading) return <Spinner fullScreen message="Loading fees..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Fee Summary */}
      {summary && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Fees</Text>
              <Text style={styles.summaryValue}>
                PKR {summary.total_fees.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Paid</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>
                PKR {summary.total_paid.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Pending</Text>
              <Text style={[styles.summaryValue, { color: Colors.error }]}>
                PKR {summary.total_pending.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Fee List */}
      <Text style={styles.sectionTitle}>Fee History</Text>

      {fees.length === 0 ? (
        <EmptyState
          title="No Fee Records"
          message="No fee records found for this student."
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
            onPayNow={handlePayNow}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xxl,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
});
