import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parentsApi } from '../../../../services/api';
import Card from '../../../../components/ui/Card';
import Spinner from '../../../../components/ui/Spinner';
import Badge from '../../../../components/ui/Badge';
import StatCard from '../../../../components/StatCard';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../../constants/colors';

interface ChildOverviewData {
  student: {
    id: number;
    name: string;
    class_name: string;
    roll_number: string;
    profile_photo_url: string | null;
  };
  attendance: {
    total_days: number;
    present: number;
    absent: number;
    late: number;
    percentage: number;
  };
  fees: {
    total_amount: number;
    paid_amount: number;
    pending_amount: number;
    status: string;
  };
  upcoming_exams: Array<{
    id: number;
    name: string;
    date: string;
    subject: string;
  }>;
}

export default function ChildOverview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ChildOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const response = await parentsApi.getChildOverview(Number(id));
      setData(response.data);
    } catch (error) {
      console.error('Failed to fetch child overview:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;
  if (!data) return <Spinner fullScreen message="No data available" />;

  const { student, attendance, fees } = data;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Student Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {student.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.studentName}>{student.name}</Text>
          <Text style={styles.studentClass}>
            {student.class_name} | Roll #{student.roll_number}
          </Text>
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard
          title="Attendance"
          value={`${attendance?.percentage ?? 0}%`}
          subtitle={`${attendance?.present ?? 0}/${attendance?.total_days ?? 0} days`}
          style={styles.statCard}
        />
        <StatCard
          title="Fee Status"
          value={fees?.status || 'N/A'}
          subtitle={fees?.pending_amount > 0 ? `PKR ${fees.pending_amount.toLocaleString()} due` : 'All clear'}
          style={styles.statCard}
        />
      </View>

      {/* Quick Navigation */}
      <Text style={styles.sectionTitle}>Details</Text>
      <View style={styles.navGrid}>
        <NavItem
          label="Attendance"
          icon="📊"
          onPress={() => router.push(`/(parent)/children/${id}/attendance`)}
        />
        <NavItem
          label="Fees"
          icon="💰"
          onPress={() => router.push(`/(parent)/children/${id}/fees`)}
        />
        <NavItem
          label="Timetable"
          icon="📅"
          onPress={() => router.push(`/(parent)/children/${id}/timetable`)}
        />
        <NavItem
          label="Results"
          icon="📝"
          onPress={() => router.push(`/(parent)/children/${id}/results`)}
        />
      </View>

      {/* Upcoming Exams */}
      {data.upcoming_exams && data.upcoming_exams.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Upcoming Exams</Text>
          {data.upcoming_exams.map((exam) => (
            <Card key={exam.id} style={styles.examCard}>
              <View style={styles.examRow}>
                <View>
                  <Text style={styles.examName}>{exam.name}</Text>
                  <Text style={styles.examSubject}>{exam.subject}</Text>
                </View>
                <Badge label={exam.date} variant="info" />
              </View>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function NavItem({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navItem} onPress={onPress}>
      <Text style={styles.navIcon}>{icon}</Text>
      <Text style={styles.navLabel}>{label}</Text>
    </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.lg,
  },
  avatarText: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  headerInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  studentClass: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  statCard: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  navGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  navItem: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  navIcon: {
    fontSize: 28,
    marginBottom: Spacing.sm,
  },
  navLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  examCard: {
    marginBottom: Spacing.sm,
  },
  examRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  examName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  examSubject: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
