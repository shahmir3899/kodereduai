import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from './ui/Card';
import Badge from './ui/Badge';
import { Colors, FontSize, Spacing } from '../constants/colors';

interface FeeCardProps {
  id: number;
  month: number;
  year: number;
  amount: string;
  amountPaid: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  dueDate?: string;
  onPayNow?: (id: number) => void;
}

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  PAID: 'success',
  UNPAID: 'error',
  PARTIAL: 'warning',
  OVERDUE: 'error',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export default function FeeCard({
  id,
  month,
  year,
  amount,
  amountPaid,
  status,
  dueDate,
  onPayNow,
}: FeeCardProps) {
  const outstanding = parseFloat(amount) - parseFloat(amountPaid);
  const showPayButton = status !== 'PAID' && onPayNow;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.monthText}>
            {MONTH_NAMES[month - 1]} {year}
          </Text>
          {dueDate && (
            <Text style={styles.dueDate}>Due: {dueDate}</Text>
          )}
        </View>
        <Badge label={status} variant={STATUS_VARIANTS[status] || 'default'} />
      </View>

      <View style={styles.amounts}>
        <View style={styles.amountItem}>
          <Text style={styles.amountLabel}>Total</Text>
          <Text style={styles.amountValue}>PKR {parseFloat(amount).toLocaleString()}</Text>
        </View>
        <View style={styles.amountItem}>
          <Text style={styles.amountLabel}>Paid</Text>
          <Text style={[styles.amountValue, { color: Colors.success }]}>
            PKR {parseFloat(amountPaid).toLocaleString()}
          </Text>
        </View>
        {outstanding > 0 && (
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Due</Text>
            <Text style={[styles.amountValue, { color: Colors.error }]}>
              PKR {outstanding.toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {showPayButton && (
        <TouchableOpacity style={styles.payButton} onPress={() => onPayNow(id)}>
          <Text style={styles.payButtonText}>Pay Now</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  monthText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  dueDate: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  amounts: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  amountItem: {
    flex: 1,
  },
  amountLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  amountValue: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  payButton: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
  },
  payButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
});
