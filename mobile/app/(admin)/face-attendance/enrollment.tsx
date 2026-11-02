import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { faceAttendanceApi, studentsApi } from '../../../services/api';
import { listOf } from '../../../services/academicYear';
import { saveFailureMessage } from '../../../services/errorKind';
import { useMasterClasses } from '../../../hooks/useAcademicYear';
import { useScopedQuery } from '../../../hooks/useScopedQuery';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Select from '../../../components/ui/Select';
import Skeleton from '../../../components/ui/Skeleton';
import ErrorState from '../../../components/ui/ErrorState';
import { useToast } from '../../../components/ui/Toast';
import { confirm } from '../../../components/ui/confirm';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Student {
  id: number;
  name: string;
  roll_number: string;
}

interface Enrollment {
  id: number;
  student: { id: number; name: string; roll_number: string };
  quality_score: number;
  source_image_url: string;
  created_at: string;
}

export default function FaceEnrollment() {
  const toast = useToast();
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  // Master classes are persisted reference data, so the picker still opens offline.
  const classesQ = useMasterClasses();
  const classOptions = (classesQ.data ?? []).map((c) => ({
    value: Number(c.id),
    label: `${c.name}${c.section ? ` - ${c.section}` : ''}`,
  }));

  const studentsQ = useScopedQuery('faceEnrollStudents', [selectedClass], async () =>
    listOf<Student>((await studentsApi.getStudents({ class_obj: selectedClass, page_size: 500 })).data),
  { enabled: !!selectedClass, staleTime: 60_000 });
  const studentOptions = (studentsQ.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (Roll: ${s.roll_number || '—'})` }));

  // Fresh each time, so an enrolment made a moment ago (or on the web) is listed.
  const enrollQ = useScopedQuery('faceEnrollments', [selectedClass], async () =>
    listOf<Enrollment>((await faceAttendanceApi.getEnrollments({ class_id: selectedClass })).data),
  { enabled: !!selectedClass, staleTime: 0 });
  const enrollments = enrollQ.data ?? [];
  const refreshControl = useRefreshControl(classesQ.refetch, enrollQ.refetch);

  const chooseClass = (id: number) => {
    setSelectedClass(id);
    setSelectedStudent(null);
    setPhoto(null);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  const handleEnroll = async () => {
    if (!selectedStudent || !photo) {
      toast.error('Choose a student and pick a photo first.');
      return;
    }

    setEnrolling(true);
    try {
      // Upload image first
      const formData = new FormData();
      const filename = photo.split('/').pop() || 'enrollment.jpg';
      formData.append('image', {
        uri: photo,
        type: 'image/jpeg',
        name: filename,
      } as unknown as Blob);

      const uploadRes = await faceAttendanceApi.uploadImage(formData);
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url;

      // Enroll face
      await faceAttendanceApi.enrollFace({
        student_id: selectedStudent,
        image_url: imageUrl,
      });

      toast.success('Face enrolled. The embedding is being generated.');
      setPhoto(null);
      setSelectedStudent(null);
      enrollQ.refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.response?.data?.detail || saveFailureMessage(error, 'Enrollment failed.'));
    } finally {
      setEnrolling(false);
    }
  };

  const handleDelete = async (enrollmentId: number) => {
    if (!(await confirm({ title: 'Remove enrollment?', message: 'This student will no longer be matched by face until enrolled again.', confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await faceAttendanceApi.deleteEnrollment(enrollmentId);
      toast.success('Enrollment removed.');
      enrollQ.refetch();
    } catch (err) {
      toast.error(saveFailureMessage(err, 'Could not remove the enrollment.'));
    }
  };

  const qualityVariant = (score: number): 'success' | 'warning' | 'error' => {
    if (score >= 0.7) return 'success';
    if (score >= 0.4) return 'warning';
    return 'error';
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
    >
      <Text style={styles.title}>Face Enrollment</Text>
      <Text style={styles.subtitle}>
        Enroll student portrait photos for face attendance matching.
      </Text>

      {/* Class Selector */}
      <Card style={styles.section}>
        <Select label="Class" value={selectedClass} options={classOptions} onChange={chooseClass}
          placeholder={classesQ.isLoading ? 'Loading classes...' : classesQ.isError ? 'Could not load classes' : 'Choose a class...'}
          disabled={classesQ.isLoading || classOptions.length === 0} />
        {classesQ.isError ? <ErrorState error={classesQ.error} onRetry={() => classesQ.refetch()} /> : null}

        {selectedClass ? (
          <Select label="Student" value={selectedStudent} options={studentOptions} onChange={setSelectedStudent}
            placeholder={studentsQ.isLoading ? 'Loading students...' : studentsQ.isError ? 'Could not load students' : 'Choose a student...'}
            disabled={studentsQ.isLoading || studentOptions.length === 0} />
        ) : null}

        {/* Photo Selection */}
        {selectedStudent && (
          <View style={styles.photoSection}>
            {photo ? (
              <View style={styles.photoPreview}>
                <Image source={{ uri: photo }} style={styles.previewImage} />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setPhoto(null)} style={styles.removePhoto}>
                  <Text style={styles.removePhotoText}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Button title="Pick Portrait Photo" variant="outline" onPress={pickPhoto} />
            )}
          </View>
        )}

        {/* Enroll Button */}
        {selectedStudent && photo && (
          <Button
            title="Enroll Face"
            onPress={handleEnroll}
            loading={enrolling}
            fullWidth
            style={{ marginTop: Spacing.lg }}
          />
        )}
      </Card>

      {/* Enrolled Faces List */}
      {selectedClass && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Enrolled Faces ({enrollments.length})
          </Text>
          {enrollQ.isLoading ? (
            <Skeleton />
          ) : enrollQ.isError && !enrollQ.data ? (
            <ErrorState error={enrollQ.error} onRetry={() => enrollQ.refetch()} />
          ) : enrollments.length === 0 ? (
            <EmptyState
              title="No Enrollments"
              message="No students in this class have face embeddings enrolled yet."
            />
          ) : (
            enrollments.map((enr) => (
              <Card key={enr.id} style={styles.enrollmentCard}>
                <View style={styles.enrollmentRow}>
                  {enr.source_image_url ? (
                    <Image source={{ uri: enr.source_image_url }} style={styles.enrollmentThumb} />
                  ) : (
                    <View style={[styles.enrollmentThumb, styles.thumbPlaceholder]}>
                      <Text style={styles.thumbPlaceholderText}>👤</Text>
                    </View>
                  )}
                  <View style={styles.enrollmentInfo}>
                    <Text style={styles.enrollmentName}>{enr.student.name}</Text>
                    <Text style={styles.enrollmentRoll}>
                      Roll: {enr.student.roll_number || '—'}
                    </Text>
                    <View style={styles.enrollmentMeta}>
                      <Badge
                        label={`Quality: ${Math.round(enr.quality_score * 100)}%`}
                        variant={qualityVariant(enr.quality_score)}
                      />
                    </View>
                  </View>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete face enrollment"
                    onPress={() => handleDelete(enr.id)}
                    style={styles.deleteBtn}
                  >
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  section: { marginBottom: Spacing.lg },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  pickerWrapper: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  picker: { height: 48 },
  photoSection: { marginTop: Spacing.lg, alignItems: 'center' },
  photoPreview: { position: 'relative', alignItems: 'center' },
  previewImage: {
    width: 150,
    height: 150,
    borderRadius: BorderRadius.lg,
  },
  removePhoto: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  enrollmentCard: { marginBottom: Spacing.sm },
  enrollmentRow: { flexDirection: 'row', alignItems: 'center' },
  enrollmentThumb: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    marginRight: Spacing.md,
  },
  thumbPlaceholder: {
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: { fontSize: 20 },
  enrollmentInfo: { flex: 1 },
  enrollmentName: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  enrollmentRoll: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  enrollmentMeta: { flexDirection: 'row', marginTop: Spacing.xs },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.errorLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { color: Colors.error, fontSize: 14, fontWeight: '600' },
});
