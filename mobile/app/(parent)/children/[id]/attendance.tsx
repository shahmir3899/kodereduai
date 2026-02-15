import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { parentsApi } from '../../../../services/api';
import AttendanceCalendar from '../../../../components/AttendanceCalendar';
import Spinner from '../../../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../../constants/colors';

interface AttendanceData {
  records: Array<{
    date: string;
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' | null;
  }>;
  summary: {
    total_days: number;
    present: number;
    absent: number;
    late: number;
    leave: number;
    percentage: number;
  };
}

export default function ChildAttendance() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const fetchData = async () => {
    try {
      const response = await parentsApi.getChildAttendance(Number(id), { month, year });
      setData(response.data);
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [id, month, year]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const goToPreviousMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const goToNextMonth = () => {
    const now = new Date();
    const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
    if (isCurrentMonth) return;

    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  if (loading) return <Spinner fullScreen message="Loading attendance..." />;

  const records = data?.records || [];
  const summary = data?.summary;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={goToPreviousMonth} style={styles.navButton}>
          <Text style={styles.navButtonText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>
          {new Date(year, month - 1).toLocaleString('default', { month: 'long' })} {year}
        </Text>
        <TouchableOpacity onPress={goToNextMonth} style={styles.navButton}>
          <Text style={styles.navButtonText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Calendar */}
      <AttendanceCalendar days={records} month={month} year={year} />

      {/* Summary Stats */}
      {summary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Monthly Summary</Text>
          <View style={styles.summaryRow}>
            <SummaryStat label="Total Days" value={summary.total_days} />
            <SummaryStat label="Present" value={summary.present} color={Colors.present} />
            <SummaryStat label="Absent" value={summary.absent} color={Colors.absent} />
            <SummaryStat label="Late" value={summary.late} color={Colors.late} />
          </View>
          <View style={styles.percentageRow}>
            <Text style={styles.percentageLabel}>Attendance Rate</Text>
            <Text style={[
              styles.percentageValue,
              { color: summary.percentage >= 75 ? Colors.success : Colors.error },
            ]}>
              {summary.percentage}%
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
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
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  navButtonText: {
    fontSize: 24,
    color: Colors.text,
    fontWeight: '600',
  },
  monthLabel: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginTop: Spacing.lg,
  },
  summaryTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: Spacing.lg,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  summaryLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  percentageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
  },
  percentageLabel: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  percentageValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
});
