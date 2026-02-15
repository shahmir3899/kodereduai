import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { financeApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Transaction {
  id: string;
  type: 'FEE' | 'EXPENSE' | 'INCOME';
  description: string;
  amount: number;
  date: string;
  status?: string;
}

const TYPE_VARIANTS: Record<string, 'success' | 'error' | 'info' | 'default'> = {
  FEE: 'success',
  EXPENSE: 'error',
  INCOME: 'info',
};

const TYPE_LABELS: Record<string, string> = {
  FEE: 'Fee Payment',
  EXPENSE: 'Expense',
  INCOME: 'Income',
};

export default function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = async () => {
    try {
      const [feesRes, expensesRes, incomeRes] = await Promise.all([
        financeApi.getFeePayments(),
        financeApi.getExpenses(),
        financeApi.getOtherIncome(),
      ]);

      const fees = (feesRes.data.results || feesRes.data || []).map((item: any) => ({
        id: `fee-${item.id}`,
        type: 'FEE' as const,
        description: `${item.student_name || 'Student'} - ${item.month ? `Month ${item.month}` : 'Fee'}`,
        amount: parseFloat(item.amount_paid || item.amount || 0),
        date: item.paid_date || item.due_date || item.created_at || '',
        status: item.status,
      }));

      const expenses = (expensesRes.data.results || expensesRes.data || []).map((item: any) => ({
        id: `exp-${item.id}`,
        type: 'EXPENSE' as const,
        description: `${item.category || 'Expense'} - ${item.description || ''}`,
        amount: parseFloat(item.amount || 0),
        date: item.date || item.created_at || '',
      }));

      const income = (incomeRes.data.results || incomeRes.data || []).map((item: any) => ({
        id: `inc-${item.id}`,
        type: 'INCOME' as const,
        description: `${item.source || 'Income'} - ${item.description || ''}`,
        amount: parseFloat(item.amount || 0),
        date: item.date || item.created_at || '',
      }));

      const combined = [...fees, ...expenses, ...income].sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      setTransactions(combined);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      Alert.alert('Error', 'Failed to load transactions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTransactions();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-PK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const renderItem = ({ item }: { item: Transaction }) => {
    const isExpense = item.type === 'EXPENSE';

    return (
      <Card style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <Badge
            label={TYPE_LABELS[item.type] || item.type}
            variant={TYPE_VARIANTS[item.type] || 'default'}
          />
          <Text style={styles.dateText}>{formatDate(item.date)}</Text>
        </View>
        <Text style={styles.description} numberOfLines={2}>
          {item.description}
        </Text>
        <Text
          style={[
            styles.amount,
            { color: isExpense ? Colors.error : Colors.success },
          ]}
        >
          {isExpense ? '-' : '+'} PKR {item.amount.toLocaleString()}
        </Text>
      </Card>
    );
  };

  if (loading) return <Spinner fullScreen message="Loading transactions..." />;

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>Transaction History</Text>
        <Text style={styles.subtitle}>{transactions.length} transactions</Text>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No Transactions"
            message="No financial transactions found."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerContainer: {
    padding: Spacing.lg,
    paddingBottom: 0,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  listContent: {
    padding: Spacing.lg,
  },
  transactionCard: {
    marginBottom: Spacing.md,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  dateText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
  description: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    lineHeight: 20,
  },
  amount: {
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
});
