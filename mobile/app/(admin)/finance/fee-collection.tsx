import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { financeApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface FeePayment {
  id: number;
  student_name: string;
  student?: number;
  month: number;
  year: number;
  amount: string;
  amount_paid: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  due_date?: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  PAID: 'success',
  UNPAID: 'error',
  PARTIAL: 'warning',
  OVERDUE: 'error',
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function FeeCollection() {
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<FeePayment | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchPayments = async () => {
    try {
      const params: Record<string, unknown> = {};
      if (search.trim()) params.search = search.trim();
      const response = await financeApi.getFeePayments(params);
      setPayments(response.data.results || response.data || []);
    } catch (error) {
      console.error('Failed to fetch fee payments:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      fetchPayments();
    }, 500);
    return () => clearTimeout(timeout);
  }, [search]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPayments();
  };

  const openPaymentModal = (payment: FeePayment) => {
    setSelectedPayment(payment);
    const remaining = parseFloat(payment.amount) - parseFloat(payment.amount_paid);
    setPaymentAmount(remaining > 0 ? String(remaining) : '');
    setModalVisible(true);
  };

  const handleRecordPayment = async () => {
    if (!selectedPayment) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    setSubmitting(true);
    try {
      await financeApi.recordPayment(selectedPayment.id, {
        amount_paid: amount,
        status: amount >= parseFloat(selectedPayment.amount) - parseFloat(selectedPayment.amount_paid)
          ? 'PAID'
          : 'PARTIAL',
      });
      Alert.alert('Success', 'Payment recorded successfully.');
      setModalVisible(false);
      setSelectedPayment(null);
      setPaymentAmount('');
      fetchPayments();
    } catch (error) {
      console.error('Failed to record payment:', error);
      Alert.alert('Error', 'Failed to record payment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: FeePayment }) => {
    const remaining = parseFloat(item.amount) - parseFloat(item.amount_paid);

    return (
      <TouchableOpacity activeOpacity={0.7} onPress={() => openPaymentModal(item)}>
        <Card style={styles.paymentCard}>
          <View style={styles.paymentHeader}>
            <View style={styles.paymentInfo}>
              <Text style={styles.studentName}>{item.student_name}</Text>
              <Text style={styles.monthText}>
                {MONTH_NAMES[item.month]} {item.year}
              </Text>
            </View>
            <Badge
              label={item.status}
              variant={STATUS_VARIANTS[item.status] || 'default'}
            />
          </View>
          <View style={styles.paymentDetails}>
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Total:</Text>
              <Text style={styles.amountValue}>PKR {parseFloat(item.amount).toLocaleString()}</Text>
            </View>
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Paid:</Text>
              <Text style={[styles.amountValue, { color: Colors.success }]}>
                PKR {parseFloat(item.amount_paid).toLocaleString()}
              </Text>
            </View>
            {remaining > 0 && (
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Remaining:</Text>
                <Text style={[styles.amountValue, { color: Colors.error }]}>
                  PKR {remaining.toLocaleString()}
                </Text>
              </View>
            )}
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  if (loading && payments.length === 0) {
    return <Spinner fullScreen message="Loading fee payments..." />;
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by student name..."
          placeholderTextColor={Colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Payments List */}
      <FlatList
        data={payments}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No Fee Payments"
            message="No fee payment records found."
          />
        }
      />

      {/* Payment Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Record Payment</Text>

            {selectedPayment && (
              <>
                <Text style={styles.modalStudent}>{selectedPayment.student_name}</Text>
                <Text style={styles.modalMonth}>
                  {MONTH_NAMES[selectedPayment.month]} {selectedPayment.year}
                </Text>

                <View style={styles.modalSummary}>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalLabel}>Total Fee:</Text>
                    <Text style={styles.modalValue}>
                      PKR {parseFloat(selectedPayment.amount).toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalLabel}>Already Paid:</Text>
                    <Text style={styles.modalValue}>
                      PKR {parseFloat(selectedPayment.amount_paid).toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalLabel}>Remaining:</Text>
                    <Text style={[styles.modalValue, { color: Colors.error }]}>
                      PKR {(parseFloat(selectedPayment.amount) - parseFloat(selectedPayment.amount_paid)).toLocaleString()}
                    </Text>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Payment Amount</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Enter amount..."
                  placeholderTextColor={Colors.placeholder}
                  value={paymentAmount}
                  onChangeText={setPaymentAmount}
                  keyboardType="numeric"
                />

                <View style={styles.modalButtons}>
                  <Button
                    title="Cancel"
                    variant="outline"
                    onPress={() => setModalVisible(false)}
                    style={styles.modalButton}
                  />
                  <Button
                    title="Record Payment"
                    onPress={handleRecordPayment}
                    loading={submitting}
                    style={styles.modalButton}
                  />
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchContainer: {
    padding: Spacing.lg,
    paddingBottom: 0,
  },
  searchInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  listContent: {
    padding: Spacing.lg,
  },
  paymentCard: {
    marginBottom: Spacing.md,
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  paymentInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  studentName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  monthText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  paymentDetails: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  amountLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  amountValue: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  modalStudent: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  modalMonth: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },
  modalSummary: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  modalSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  modalValue: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  inputLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  amountInput: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.lg,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  modalButton: {
    flex: 1,
  },
});
