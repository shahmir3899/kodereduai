import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { faceAttendanceApi } from '../../../services/api';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';
import Spinner from '../../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Detection {
  face_index: number;
  face_crop_url: string;
  match_status: 'AUTO_MATCHED' | 'FLAGGED' | 'IGNORED' | 'MANUALLY_MATCHED' | 'REMOVED';
  matched_student: { id: number; name: string; roll_number: string } | null;
  confidence: number;
  quality_score: number;
  alternative_matches: Array<{ student_id: number; name: string; confidence: number }>;
}

interface ClassStudent {
  id: number;
  name: string;
  roll_number: string;
  has_embedding: boolean;
  matched: boolean;
}

interface SessionData {
  id: string;
  status: string;
  class_obj: { id: number; name: string };
  date: string;
  image_url: string;
  total_faces_detected: number;
  faces_matched: number;
  faces_flagged: number;
  faces_ignored: number;
  detections: Detection[];
  class_students: ClassStudent[];
  error_message?: string;
}

export default function FaceAttendanceReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [presentIds, setPresentIds] = useState<Set<number>>(new Set());

  const fetchSession = useCallback(async () => {
    try {
      const res = await faceAttendanceApi.getSession(id!);
      const data = res.data;
      setSession(data);

      // Initialize present IDs from auto-matched + flagged detections
      if (data.status === 'NEEDS_REVIEW' && presentIds.size === 0) {
        const matched = new Set<number>();
        for (const det of data.detections || []) {
          if (
            (det.match_status === 'AUTO_MATCHED' || det.match_status === 'FLAGGED') &&
            det.matched_student
          ) {
            matched.add(det.matched_student.id);
          }
        }
        setPresentIds(matched);
      }
    } catch (err) {
      console.error('Failed to fetch session:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Poll while processing
  useEffect(() => {
    if (!session || session.status !== 'PROCESSING') return;
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, [session?.status, fetchSession]);

  const toggleStudent = (studentId: number) => {
    setPresentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!session) return;
    setConfirming(true);
    try {
      await faceAttendanceApi.confirmSession(session.id, {
        present_student_ids: Array.from(presentIds),
      });
      Alert.alert('Success', 'Attendance confirmed successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      const msg =
        error.response?.data?.error || error.response?.data?.detail || 'Confirmation failed.';
      Alert.alert('Error', msg);
    } finally {
      setConfirming(false);
    }
  };

  const handleReprocess = async () => {
    if (!session) return;
    try {
      await faceAttendanceApi.reprocessSession(session.id);
      setSession((prev) => (prev ? { ...prev, status: 'PROCESSING' } : prev));
    } catch (error: any) {
      Alert.alert('Error', 'Failed to reprocess session.');
    }
  };

  const statusBadge = useMemo(() => {
    if (!session) return null;
    const map: Record<string, { label: string; variant: 'info' | 'warning' | 'success' | 'error' | 'default' }> = {
      PROCESSING: { label: 'Processing...', variant: 'info' },
      NEEDS_REVIEW: { label: 'Needs Review', variant: 'warning' },
      CONFIRMED: { label: 'Confirmed', variant: 'success' },
      FAILED: { label: 'Failed', variant: 'error' },
    };
    return map[session.status] || { label: session.status, variant: 'default' as const };
  }, [session?.status]);

  if (loading) return <Spinner fullScreen message="Loading session..." />;

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Session not found.</Text>
        <Button title="Go Back" onPress={() => router.back()} variant="outline" />
      </View>
    );
  }

  // Processing state
  if (session.status === 'PROCESSING') {
    return (
      <View style={styles.centered}>
        <Spinner message="Detecting and matching faces..." />
        <Text style={styles.subText}>This may take up to 30 seconds.</Text>
      </View>
    );
  }

  // Failed state
  if (session.status === 'FAILED') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Processing Failed</Text>
        <Text style={styles.subText}>{session.error_message || 'Unknown error occurred.'}</Text>
        <View style={styles.failedActions}>
          <Button title="Reprocess" onPress={handleReprocess} />
          <Button title="Go Back" variant="outline" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const matchBadgeVariant = (status: string): 'success' | 'warning' | 'default' | 'purple' => {
    switch (status) {
      case 'AUTO_MATCHED': return 'success';
      case 'FLAGGED': return 'warning';
      case 'MANUALLY_MATCHED': return 'purple';
      default: return 'default';
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchSession(); }} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{session.class_obj?.name || 'Face Attendance'}</Text>
          <Text style={styles.date}>{session.date}</Text>
        </View>
        {statusBadge && <Badge label={statusBadge.label} variant={statusBadge.variant} size="md" />}
      </View>

      {/* Summary Stats */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{session.total_faces_detected}</Text>
          <Text style={styles.statLabel}>Detected</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: Colors.success }]}>{session.faces_matched}</Text>
          <Text style={styles.statLabel}>Matched</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: Colors.warning }]}>{session.faces_flagged}</Text>
          <Text style={styles.statLabel}>Flagged</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: Colors.textTertiary }]}>{session.faces_ignored}</Text>
          <Text style={styles.statLabel}>Ignored</Text>
        </View>
      </View>

      {/* Detected Faces */}
      {session.detections && session.detections.length > 0 && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            Detected Faces ({session.detections.length})
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.facesScroll}>
            {session.detections.map((det) => (
              <View key={det.face_index} style={styles.faceCard}>
                {det.face_crop_url ? (
                  <Image source={{ uri: det.face_crop_url }} style={styles.faceCrop} />
                ) : (
                  <View style={[styles.faceCrop, styles.facePlaceholder]}>
                    <Text style={styles.facePlaceholderText}>?</Text>
                  </View>
                )}
                <Badge
                  label={det.match_status.replace('_', ' ')}
                  variant={matchBadgeVariant(det.match_status)}
                />
                {det.matched_student && (
                  <Text style={styles.matchedName} numberOfLines={1}>
                    {det.matched_student.name}
                  </Text>
                )}
                <Text style={styles.confidenceText}>
                  {det.confidence > 0 ? `${Math.round(det.confidence)}%` : '—'}
                </Text>
              </View>
            ))}
          </ScrollView>
        </Card>
      )}

      {/* Class Roll */}
      {session.status === 'NEEDS_REVIEW' && session.class_students && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            Class Roll ({presentIds.size}/{session.class_students.length} present)
          </Text>
          {session.class_students.map((student) => (
            <TouchableOpacity
              key={student.id}
              style={[
                styles.studentRow,
                presentIds.has(student.id) && styles.studentRowPresent,
              ]}
              onPress={() => toggleStudent(student.id)}
              activeOpacity={0.7}
            >
              <View style={styles.studentInfo}>
                <Text style={styles.studentName}>{student.name}</Text>
                <Text style={styles.studentRoll}>
                  Roll: {student.roll_number || '—'}
                  {!student.has_embedding && ' (no face enrolled)'}
                </Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  presentIds.has(student.id) && styles.checkboxChecked,
                ]}
              >
                {presentIds.has(student.id) && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      {/* Actions */}
      {session.status === 'NEEDS_REVIEW' && (
        <View style={styles.actions}>
          <Button
            title="Confirm Attendance"
            onPress={handleConfirm}
            loading={confirming}
            fullWidth
          />
          <Button
            title="Reprocess"
            variant="outline"
            onPress={handleReprocess}
            fullWidth
          />
        </View>
      )}

      {/* Confirmed summary */}
      {session.status === 'CONFIRMED' && (
        <Card style={styles.section}>
          <Text style={styles.confirmedText}>
            Attendance has been confirmed for this session.
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxxl,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  date: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  errorText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.error,
    marginBottom: Spacing.md,
  },
  subText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  failedActions: { gap: Spacing.md, marginTop: Spacing.xl, width: '100%' },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.text },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  section: { marginBottom: Spacing.lg },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  facesScroll: { marginHorizontal: -Spacing.sm },
  faceCard: {
    alignItems: 'center',
    marginHorizontal: Spacing.sm,
    width: 90,
  },
  faceCrop: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  facePlaceholder: {
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facePlaceholderText: {
    fontSize: FontSize.xxl,
    color: Colors.textTertiary,
  },
  matchedName: {
    fontSize: FontSize.xs,
    fontWeight: '500',
    color: Colors.text,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  confidenceText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  studentRowPresent: {
    backgroundColor: Colors.successLight,
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  studentInfo: { flex: 1 },
  studentName: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  studentRoll: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  checkmark: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  actions: { gap: Spacing.md, marginTop: Spacing.md },
  confirmedText: {
    fontSize: FontSize.sm,
    color: Colors.success,
    fontWeight: '500',
    textAlign: 'center',
  },
});
