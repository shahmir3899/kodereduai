import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { financeApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import StatCard from '../../../components/StatCard';
import QueryBoundary from '../../../components/ui/QueryBoundary';
import { useScopedQuery } from '../../../hooks/useScopedQuery';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface FinanceSummary {
  total_collection: number;
  total_expenses: number;
  balance: number;
  total_other_income?: number;
  pending_fees?: number;
  monthly_collection?: number;
}

export default function FinanceDashboard() {
  const router = useRouter();
  // 'finance' is a money root, so the balance is never served from a cache.
  const query = useScopedQuery<FinanceSummary>('finance', ['summary'], async () => (await financeApi.getFinanceSummary()).data);
  const refreshControl = useRefreshControl(query.refetch);

  const navItems = [
    {
      title: 'Financial Reports',
      subtitle: 'Income, expenses, trends and PDF export',
      route: '/(admin)/finance/reports',
      color: Colors.info,
    },
    {
      title: 'Fee Collection',
      subtitle: 'Manage student fee payments',
      route: '/(admin)/finance/fee-collection',
      color: Colors.primary,
    },
    {
      title: 'Record Expense',
      subtitle: 'Add school expenses',
      route: '/(admin)/finance/expense',
      color: Colors.error,
    },
    {
      title: 'Record Income',
      subtitle: 'Add other income sources',
      route: '/(admin)/finance/income',
      color: Colors.success,
    },
    {
      title: 'Transaction History',
      subtitle: 'View all transactions',
      route: '/(admin)/finance/transactions',
      color: Colors.secondary,
    },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
    >
      <Text style={styles.title}>Finance Dashboard</Text>

      {/* Summary Cards */}
      <QueryBoundary query={query} isEmpty={() => false}>
        {(summary) => (
        <View style={styles.statsContainer}>
          <View style={styles.statsRow}>
            <StatCard
              title="Total Collection"
              value={`PKR ${(summary.total_collection || 0).toLocaleString()}`}
              color={Colors.success}
            />
            <StatCard
              title="Total Expenses"
              value={`PKR ${(summary.total_expenses || 0).toLocaleString()}`}
              color={Colors.error}
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              title="Balance"
              value={`PKR ${(summary.balance || 0).toLocaleString()}`}
              color={Colors.primary}
            />
            {summary.total_other_income !== undefined && (
              <StatCard
                title="Other Income"
                value={`PKR ${(summary.total_other_income || 0).toLocaleString()}`}
                color={Colors.secondary}
              />
            )}
          </View>
        </View>
        )}
      </QueryBoundary>

      {/* Navigation Items */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      {navItems.map((item) => (
        <TouchableOpacity accessibilityRole="button"
          key={item.route}
          activeOpacity={0.7}
          onPress={() => router.push(item.route as any)}
        >
          <Card style={styles.navCard}>
            <View style={styles.navCardContent}>
              <View style={[styles.navIndicator, { backgroundColor: item.color }]} />
              <View style={styles.navTextContainer}>
                <Text style={styles.navTitle}>{item.title}</Text>
                <Text style={styles.navSubtitle}>{item.subtitle}</Text>
              </View>
              <Text style={styles.navArrow}>›</Text>
            </View>
          </Card>
        </TouchableOpacity>
      ))}
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
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  statsContainer: {
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  navCard: {
    marginBottom: Spacing.md,
  },
  navCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navIndicator: {
    width: 4,
    height: 40,
    borderRadius: BorderRadius.full,
    marginRight: Spacing.md,
  },
  navTextContainer: {
    flex: 1,
  },
  navTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  navSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  navArrow: {
    fontSize: FontSize.xxl,
    color: Colors.textTertiary,
    fontWeight: '300',
  },
});
