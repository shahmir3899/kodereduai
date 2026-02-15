import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { studentPortalApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import StatCard from '../../components/StatCard';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface DashboardData {
  student_name: string;
  class_name: string;
  roll_number: string;
  attendance_percentage: number;
  today_classes: Array<{
    subject_name: string;
    start_time: string;
    end_time: string;
    teacher_name?: string;
  }>;
  upcoming_assignments: Array<{
    id: number;
    title: string;
    subject_name: string;
    due_date: string;
  }>;
  fee_status: {
    pending_amount: number;
    status: string;
  };
}

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = async () => {
    try {
      const response = await studentPortalApi.getDashboard();
      setData(response.data);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboard();
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Welcome */}
      <View style={styles.welcome}>
        <View>
          <Text style={styles.greeting}>
            Hi, {data?.student_name || user?.username || 'Student'}
          </Text>
          <Text style={styles.classInfo}>
            {data?.class_name || ''} {data?.roll_number ? `| Roll #${data.roll_number}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <StatCard
          title="Attendance"
          value={`${data?.attendance_percentage ?? 0}%`}
          color={
            (data?.attendance_percentage ?? 0) >= 75
              ? Colors.success
              : Colors.error
          }
        />
        <StatCard
          title="Pending Fees"
          value={
            data?.fee_status?.pending_amount
              ? `PKR ${data.fee_status.pending_amount.toLocaleString()}`
              : 'Clear'
          }
          color={data?.fee_status?.pending_amount ? Colors.error : Colors.success}
        />
      </View>

      {/* Today's Classes */}
      <Text style={styles.sectionTitle}>Today's Classes</Text>
      {(!data?.today_classes || data.today_classes.length === 0) ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>No classes today</Text>
        </Card>
      ) : (
        data.today_classes.map((cls, idx) => (
          <Card key={idx} style={styles.classCard}>
            <View style={styles.classRow}>
              <View style={styles.timeBox}>
                <Text style={styles.timeText}>
                  {cls.start_time?.slice(0, 5)}
                </Text>
              </View>
              <View style={styles.classInfo2}>
                <Text style={styles.className}>{cls.subject_name}</Text>
                {cls.teacher_name && (
                  <Text style={styles.teacherName}>{cls.teacher_name}</Text>
                )}
              </View>
            </View>
          </Card>
        ))
      )}

      {/* Upcoming Assignments */}
      <Text style={styles.sectionTitle}>Upcoming Assignments</Text>
      {(!data?.upcoming_assignments || data.upcoming_assignments.length === 0) ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>No upcoming assignments</Text>
        </Card>
      ) : (
        data.upcoming_assignments.slice(0, 5).map((assignment) => (
          <TouchableOpacity
            key={assignment.id}
            onPress={() => router.push('/(student)/assignments')}
          >
            <Card key={assignment.id} style={styles.assignmentCard}>
              <View style={styles.assignmentRow}>
                <View>
                  <Text style={styles.assignmentTitle}>{assignment.title}</Text>
                  <Text style={styles.assignmentSubject}>{assignment.subject_name}</Text>
                </View>
                <Text style={styles.dueDate}>Due: {assignment.due_date}</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <QuickAction label="Attendance" icon="📊" onPress={() => router.push('/(student)/attendance')} />
        <QuickAction label="Timetable" icon="📅" onPress={() => router.push('/(student)/timetable')} />
        <QuickAction label="Results" icon="📝" onPress={() => router.push('/(student)/results')} />
        <QuickAction label="Fees" icon="💰" onPress={() => router.push('/(student)/fees')} />
      </View>
    </ScrollView>
  );
}

function QuickAction({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
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
  welcome: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xxl,
  },
  greeting: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  classInfo: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  logoutText: {
    fontSize: FontSize.sm,
    color: Colors.error,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
    marginTop: Spacing.md,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  classCard: {
    marginBottom: Spacing.sm,
  },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeBox: {
    backgroundColor: Colors.primaryLight + '20',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginRight: Spacing.md,
  },
  timeText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  classInfo2: {
    flex: 1,
  },
  className: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  teacherName: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  assignmentCard: {
    marginBottom: Spacing.sm,
  },
  assignmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assignmentTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  assignmentSubject: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dueDate: {
    fontSize: FontSize.xs,
    color: Colors.warning,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  actionButton: {
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
  actionIcon: {
    fontSize: 28,
    marginBottom: Spacing.sm,
  },
  actionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    color: Colors.text,
  },
});
