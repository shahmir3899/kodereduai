import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { attendanceApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface PendingUpload {
  id: number;
  date: string;
  image_url: string;
  status: string;
  recognized_students: Array<{
    student_id: number;
    student_name: string;
    confidence: number;
    status: 'PRESENT' | 'ABSENT';
  }>;
  total_detected: number;
  created_at: string;
}

export default function ReviewAttendance() {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);

  const fetchUploads = async () => {
    try {
      const response = await attendanceApi.getPendingReviews();
      const data = response.data;
      setUploads(data.results || data || []);
    } catch (error) {
      console.error('Failed to fetch pending reviews:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUploads();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchUploads();
  };

  const handleConfirm = async (uploadId: number, students: PendingUpload['recognized_students']) => {
    setConfirming(uploadId);
    try {
      await attendanceApi.confirmAttendance(uploadId, {
        students: students.map((s) => ({
          student_id: s.student_id,
          status: s.status,
        })),
      });
      Alert.alert('Success', 'Attendance confirmed successfully.');
      fetchUploads();
    } catch (error) {
      console.error('Failed to confirm:', error);
      Alert.alert('Error', 'Failed to confirm attendance.');
    } finally {
      setConfirming(null);
    }
  };

  if (loading) return <Spinner fullScreen message="Loading pending reviews..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Review Attendance</Text>

      {uploads.length === 0 ? (
        <EmptyState title="All Clear" message="No pending attendance uploads to review." />
      ) : (
        uploads.map((upload) => (
          <Card key={upload.id} style={styles.uploadCard}>
            <View style={styles.uploadHeader}>
              <View>
                <Text style={styles.uploadDate}>Date: {upload.date}</Text>
                <Text style={styles.uploadMeta}>
                  {upload.total_detected} students detected
                </Text>
              </View>
              <Badge label={upload.status} variant={upload.status === 'PENDING_REVIEW' ? 'warning' : 'default'} />
            </View>

            {/* Student List */}
            {upload.recognized_students?.map((student) => (
              <View key={student.student_id} style={styles.studentRow}>
                <View style={styles.studentInfo}>
                  <Text style={styles.studentName}>{student.student_name}</Text>
                  <Text style={styles.confidence}>
                    {Math.round(student.confidence * 100)}% confidence
                  </Text>
                </View>
                <Badge
                  label={student.status}
                  variant={student.status === 'PRESENT' ? 'success' : 'error'}
                />
              </View>
            ))}

            <Button
              title="Confirm Attendance"
              onPress={() => handleConfirm(upload.id, upload.recognized_students)}
              loading={confirming === upload.id}
              style={{ marginTop: Spacing.md }}
            />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  uploadCard: { marginBottom: Spacing.lg },
  uploadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  uploadDate: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  uploadMeta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  studentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  studentInfo: { flex: 1 },
  studentName: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  confidence: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
});
