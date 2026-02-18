import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Picker } from '@react-native-picker/picker';
import { faceAttendanceApi, classesApi, studentsApi } from '../../../services/api';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface ClassItem {
  id: number;
  name: string;
  section?: string;
}

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
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedClass) {
      loadStudents(selectedClass);
      loadEnrollments();
    } else {
      setStudents([]);
      setEnrollments([]);
    }
    setSelectedStudent('');
    setPhoto(null);
  }, [selectedClass]);

  const loadClasses = async () => {
    try {
      const res = await classesApi.getClasses({ page_size: 100 });
      setClasses(res.data.results || res.data || []);
    } catch (err) {
      console.error('Failed to load classes:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStudents = async (classId: string) => {
    try {
      const res = await studentsApi.getStudents({ class_obj: classId, page_size: 100 });
      setStudents(res.data.results || res.data || []);
    } catch (err) {
      console.error('Failed to load students:', err);
    }
  };

  const loadEnrollments = async () => {
    try {
      const params: Record<string, unknown> = {};
      if (selectedClass) params.class_id = selectedClass;
      const res = await faceAttendanceApi.getEnrollments(params);
      setEnrollments(res.data.results || res.data || []);
    } catch (err) {
      console.error('Failed to load enrollments:', err);
    }
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
      Alert.alert('Error', 'Please select a student and pick a photo.');
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
        student_id: parseInt(selectedStudent),
        image_url: imageUrl,
      });

      Alert.alert('Success', 'Face enrolled successfully. The embedding is being generated.');
      setPhoto(null);
      setSelectedStudent('');
      loadEnrollments();
    } catch (error: any) {
      const msg =
        error.response?.data?.error || error.response?.data?.detail || 'Enrollment failed.';
      Alert.alert('Error', msg);
    } finally {
      setEnrolling(false);
    }
  };

  const handleDelete = (enrollmentId: number) => {
    Alert.alert('Remove Enrollment', 'Are you sure you want to remove this face enrollment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await faceAttendanceApi.deleteEnrollment(enrollmentId);
            loadEnrollments();
          } catch (err) {
            Alert.alert('Error', 'Failed to remove enrollment.');
          }
        },
      },
    ]);
  };

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([loadClasses(), selectedClass ? loadEnrollments() : Promise.resolve()]).finally(
      () => setRefreshing(false)
    );
  };

  const qualityVariant = (score: number): 'success' | 'warning' | 'error' => {
    if (score >= 0.7) return 'success';
    if (score >= 0.4) return 'warning';
    return 'error';
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Face Enrollment</Text>
      <Text style={styles.subtitle}>
        Enroll student portrait photos for face attendance matching.
      </Text>

      {/* Class Selector */}
      <Card style={styles.section}>
        <Text style={styles.label}>Select Class</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={selectedClass}
            onValueChange={setSelectedClass}
            style={styles.picker}
          >
            <Picker.Item label="Choose a class..." value="" />
            {classes.map((cls) => (
              <Picker.Item
                key={cls.id}
                label={`${cls.name}${cls.section ? ` - ${cls.section}` : ''}`}
                value={String(cls.id)}
              />
            ))}
          </Picker>
        </View>

        {/* Student Selector */}
        {selectedClass && (
          <>
            <Text style={[styles.label, { marginTop: Spacing.lg }]}>Select Student</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedStudent}
                onValueChange={setSelectedStudent}
                style={styles.picker}
              >
                <Picker.Item label="Choose a student..." value="" />
                {students.map((s) => (
                  <Picker.Item
                    key={s.id}
                    label={`${s.name} (Roll: ${s.roll_number || '—'})`}
                    value={String(s.id)}
                  />
                ))}
              </Picker>
            </View>
          </>
        )}

        {/* Photo Selection */}
        {selectedStudent && (
          <View style={styles.photoSection}>
            {photo ? (
              <View style={styles.photoPreview}>
                <Image source={{ uri: photo }} style={styles.previewImage} />
                <TouchableOpacity onPress={() => setPhoto(null)} style={styles.removePhoto}>
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
          {enrollments.length === 0 ? (
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
                  <TouchableOpacity
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
