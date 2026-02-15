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
import { attendanceApi, studentsApi, financeApi } from '../../services/api';
import StatCard from '../../components/StatCard';
import Card from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface DashboardStats {
  total_students: number;
  today_attendance_pct: number;
  monthly_collection: number;
  pending_approvals: number;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      const [studentsRes, financeRes] = await Promise.allSettled([
        studentsApi.getStudents({ page_size: 1 }),
        financeApi.getFinanceSummary(),
      ]);

      setStats({
        total_students: studentsRes.status === 'fulfilled' ? (studentsRes.value.data.count || 0) : 0,
        today_attendance_pct: 0,
        monthly_collection: financeRes.status === 'fulfilled' ? (financeRes.value.data.total_collection || financeRes.value.data.monthly_collection || 0) : 0,
        pending_approvals: 0,
      });
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome, {user?.username || 'Admin'}</Text>
          <Text style={styles.role}>School Administrator</Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsGrid}>
        <StatCard title="Students" value={stats?.total_students || 0} color={Colors.primary} />
        <StatCard title="Attendance" value={`${stats?.today_attendance_pct || 0}%`} color={Colors.success} />
        <StatCard title="Collection" value={`PKR ${(stats?.monthly_collection || 0).toLocaleString()}`} color={Colors.warning} />
        <StatCard title="Approvals" value={stats?.pending_approvals || 0} color={Colors.error} />
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <ActionItem label="Capture" icon="📸" onPress={() => router.push('/(admin)/attendance/capture')} />
        <ActionItem label="Students" icon="👥" onPress={() => router.push('/(admin)/students')} />
        <ActionItem label="Finance" icon="💰" onPress={() => router.push('/(admin)/finance')} />
        <ActionItem label="Send Alert" icon="📢" onPress={() => router.push('/(admin)/notifications/send')} />
        <ActionItem label="HR" icon="🏢" onPress={() => router.push('/(admin)/hr/staff')} />
        <ActionItem label="Timetable" icon="📅" onPress={() => router.push('/(admin)/timetable')} />
        <ActionItem label="Results" icon="📊" onPress={() => router.push('/(admin)/results')} />
        <ActionItem label="AI Chat" icon="🤖" onPress={() => router.push('/(admin)/ai-assistant')} />
      </View>

      {/* More Module Links */}
      <Text style={styles.sectionTitle}>Modules</Text>
      <ModuleLink label="Leave Approvals" onPress={() => router.push('/(admin)/hr/leave-approvals')} />
      <ModuleLink label="Gate Passes" onPress={() => router.push('/(admin)/hostel/gate-passes')} />
      <ModuleLink label="Transport" onPress={() => router.push('/(admin)/transport')} />
      <ModuleLink label="Library" onPress={() => router.push('/(admin)/library/issue')} />
      <ModuleLink label="Notification History" onPress={() => router.push('/(admin)/notifications/history')} />
    </ScrollView>
  );
}

function ActionItem({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function ModuleLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress}>
      <Card style={styles.moduleCard}>
        <Text style={styles.moduleName}>{label}</Text>
        <Text style={styles.moduleArrow}>›</Text>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.xxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  role: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  logoutText: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.xxl },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md, marginTop: Spacing.md },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.lg },
  actionButton: { width: '22%', backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center', shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  actionIcon: { fontSize: 24, marginBottom: Spacing.xs },
  actionLabel: { fontSize: FontSize.xs, fontWeight: '500', color: Colors.text, textAlign: 'center' },
  moduleCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  moduleName: { fontSize: FontSize.md, fontWeight: '500', color: Colors.text },
  moduleArrow: { fontSize: 20, color: Colors.textTertiary },
});
