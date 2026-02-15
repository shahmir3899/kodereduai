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
import { studentsApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface StudentDetail {
  id: number;
  name: string;
  class_name: string;
  roll_number: string;
  email?: string;
  phone?: string;
  guardian_name?: string;
  guardian_phone?: string;
  address?: string;
  date_of_birth?: string;
  admission_date?: string;
  status?: string;
}

interface AttendanceRecord {
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
}

interface FeeRecord {
  id: number;
  month: number;
  year: number;
  amount: string;
  amount_paid: string;
  status: string;
}

type Tab = 'info' | 'attendance' | 'fees';

export default function StudentProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('info');

  const fetchData = async () => {
    try {
      const [studentRes, attendanceRes, feesRes] = await Promise.allSettled([
        studentsApi.getStudent(Number(id)),
        studentsApi.getAttendanceHistory(Number(id)),
        studentsApi.getFeeLedger(Number(id)),
      ]);

      if (studentRes.status === 'fulfilled') setStudent(studentRes.value.data);
      if (attendanceRes.status === 'fulfilled') {
        const d = attendanceRes.value.data;
        setAttendance(d.records || d.results || d || []);
      }
      if (feesRes.status === 'fulfilled') {
        const d = feesRes.value.data;
        setFees(d.fees || d.results || d || []);
      }
    } catch (error) {
      console.error('Failed to fetch student data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [id]);
  const onRefresh = () => { setRefreshing(true); fetchData(); };

  if (loading) return <Spinner fullScreen message="Loading student..." />;
  if (!student) return <Spinner fullScreen message="Student not found" />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{student.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{student.name}</Text>
          <Text style={styles.classText}>{student.class_name} | Roll #{student.roll_number}</Text>
        </View>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => router.push(`/(admin)/students/${id}/edit`)}
        >
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {(['info', 'attendance', 'fees'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'info' && (
        <Card>
          <InfoRow label="Email" value={student.email} />
          <InfoRow label="Phone" value={student.phone} />
          <InfoRow label="Guardian" value={student.guardian_name} />
          <InfoRow label="Guardian Phone" value={student.guardian_phone} />
          <InfoRow label="Date of Birth" value={student.date_of_birth} />
          <InfoRow label="Admission Date" value={student.admission_date} />
          <InfoRow label="Address" value={student.address} />
        </Card>
      )}

      {activeTab === 'attendance' && (
        <View>
          {attendance.length === 0 ? (
            <Text style={styles.emptyText}>No attendance records</Text>
          ) : (
            attendance.slice(0, 30).map((record, idx) => (
              <View key={idx} style={styles.attendanceRow}>
                <Text style={styles.attendanceDate}>{record.date}</Text>
                <Badge
                  label={record.status}
                  variant={record.status === 'PRESENT' ? 'success' : record.status === 'ABSENT' ? 'error' : 'warning'}
                />
              </View>
            ))
          )}
        </View>
      )}

      {activeTab === 'fees' && (
        <View>
          {fees.length === 0 ? (
            <Text style={styles.emptyText}>No fee records</Text>
          ) : (
            fees.map((fee) => (
              <Card key={fee.id} style={styles.feeCard}>
                <View style={styles.feeRow}>
                  <Text style={styles.feeMonth}>{fee.month}/{fee.year}</Text>
                  <Text style={styles.feeAmount}>PKR {parseFloat(fee.amount).toLocaleString()}</Text>
                  <Badge label={fee.status} variant={fee.status === 'PAID' ? 'success' : 'error'} />
                </View>
              </Card>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xxl },
  avatar: { width: 56, height: 56, borderRadius: BorderRadius.full, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  avatarText: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textInverse },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  classText: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  editBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm },
  editBtnText: { color: Colors.textInverse, fontWeight: '600', fontSize: FontSize.sm },
  tabs: { flexDirection: 'row', marginBottom: Spacing.lg, gap: Spacing.sm },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  tabTextActive: { color: Colors.textInverse },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  infoLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  infoValue: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text, flex: 1, textAlign: 'right' },
  emptyText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', paddingVertical: Spacing.xxxl },
  attendanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  attendanceDate: { fontSize: FontSize.sm, color: Colors.text },
  feeCard: { marginBottom: Spacing.sm },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeMonth: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  feeAmount: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
});
