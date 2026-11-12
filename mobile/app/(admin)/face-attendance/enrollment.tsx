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
import {
  COVERAGE_FILTERS, COVERAGE_LABEL, COVERAGE_TONE, POLL_LIMIT, POLL_MS, PORTRAIT_TIPS, buildEnrollPayload, coverageLine, coverageSummaryLine, duplicateOf,
  enrollErrorText, enrollOutcome, enrollTimeoutText, filterCoverage, overrideText, photoMime, photoName, photosToAdd, type Coverage, type CoverageState, type EnrollTask,
} from '../../../services/faceEnroll';
import SegmentedTabs from '../../../components/ui/SegmentedTabs';
import StatusPill from '../../../components/ui/StatusPill';
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

// The list sends the student as an id with student_name and student_roll beside it.
interface Enrollment {
  id: number;
  student: number;
  student_name?: string;
  student_roll?: string | number | null;
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
  const [progress, setProgress] = useState('');
  const [filter, setFilter] = useState<'' | CoverageState>('');

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
  const coverageQ = useScopedQuery<Coverage>('faceCoverage', [selectedClass], async () =>
    (await faceAttendanceApi.getEnrollmentCoverage({ class_id: selectedClass })).data as Coverage,
  { enabled: !!selectedClass, staleTime: 0 });
  const coverage = coverageQ.data;
  const refreshControl = useRefreshControl(classesQ.refetch, enrollQ.refetch, coverageQ.refetch);
  const recommended = coverage?.recommended_samples ?? 3;
  const chosen = coverage?.students.find((c) => c.student_id === selectedStudent);

  const chooseClass = (id: number) => {
    setSelectedClass(id);
    setSelectedStudent(null);
    setPhoto(null);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
  };

  // The phone's camera, front-facing portrait: what most enrolments should use.
  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.error('Allow the camera in your phone settings to take a photo.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true, aspect: [1, 1], cameraType: ImagePicker.CameraType.front });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
  };

  // The server works on the photo in the background: wait for its answer (a few seconds) and report it.
  const waitForOutcome = async (taskId: string) => {
    for (let i = 0; i < POLL_LIMIT; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const t = (await faceAttendanceApi.getTask(taskId)).data as EnrollTask;
      const o = enrollOutcome(t);
      if (o.state !== 'running') return o;
    }
    return null;
  };

  const enrollWith = async (imageUrl: string, name: string, override: boolean): Promise<boolean> => {
    setProgress('Checking the photo...');
    const res = await faceAttendanceApi.enrollFace(buildEnrollPayload(selectedStudent as number, imageUrl, override));
    const taskId = (res.data as { task_id?: string })?.task_id;
    if (!taskId) return true;
    const outcome = await waitForOutcome(taskId);
    if (!outcome) { toast.show(enrollTimeoutText, 'info'); return true; }
    if (outcome.state === 'done') { toast.success(`${name}: photo added.`); return true; }
    if (outcome.state === 'duplicate' && !override) {
      const other = duplicateOf(outcome.message);
      if (await confirm({ title: 'Different people?', message: overrideText(name, other), confirmLabel: 'They are different' })) return enrollWith(imageUrl, name, true);
      return false;
    }
    toast.error(outcome.message);
    return false;
  };

  const handleEnroll = async () => {
    if (!selectedStudent || !photo) {
      toast.error('Choose a student and take or pick a photo first.');
      return;
    }
    const name = studentsQ.data?.find((x) => x.id === selectedStudent)?.name ?? 'The student';
    setEnrolling(true);
    try {
      setProgress('Uploading the photo...');
      const formData = new FormData();
      formData.append('image', { uri: photo, type: photoMime(photo), name: photoName(photo, 'enrollment.jpg') } as unknown as Blob);
      const uploadRes = await faceAttendanceApi.uploadImage(formData);
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url;
      const ok = await enrollWith(imageUrl, name, false);
      if (ok) setPhoto(null); // the student stays chosen, to add the next photo
      enrollQ.refetch(); coverageQ.refetch();
    } catch (error) {
      toast.error(enrollErrorText(error, saveFailureMessage(error, 'Enrolment failed.')));
    } finally {
      setEnrolling(false); setProgress('');
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
        Take a few portrait photos of each student, in good light, for face attendance matching.
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
              <View style={styles.photoButtons}>
                <Button title="Take a photo" variant="outline" onPress={takePhoto} />
                <Button title="Pick from gallery" variant="ghost" size="sm" onPress={pickPhoto} />
                {PORTRAIT_TIPS.map((t) => <Text key={t} style={styles.tip}>•  {t}</Text>)}
              </View>
            )}
          </View>
        )}

        {/* Enroll Button */}
        {selectedStudent && chosen ? (
          <Text style={styles.tip}>{`${chosen.samples} of ${recommended} photos so far${photosToAdd(chosen.samples, recommended) > 0 ? `: add ${photosToAdd(chosen.samples, recommended)} more from slightly different angles.` : '.'}`}</Text>
        ) : null}
        {enrolling && progress ? <Text style={styles.tip}>{progress}</Text> : null}
        {selectedStudent && photo && (
          <Button
            title="Add this photo"
            onPress={handleEnroll}
            loading={enrolling}
            fullWidth
            style={{ marginTop: Spacing.lg }}
          />
        )}
      </Card>

      {/* Who still needs photos */}
      {selectedClass ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who needs photos</Text>
          {coverageQ.isLoading ? <Skeleton /> : coverageQ.isError && !coverage ? <ErrorState error={coverageQ.error} onRetry={() => coverageQ.refetch()} /> : coverage ? (
            <>
              <Text style={styles.tip}>{coverageSummaryLine(coverage)}</Text>
              <SegmentedTabs tabs={COVERAGE_FILTERS} value={filter} onChange={(v) => setFilter(v as '' | CoverageState)} scrollable />
              {filterCoverage(coverage.students, filter).map((c) => (
                <TouchableOpacity key={c.student_id} accessibilityRole="button" onPress={() => { setSelectedStudent(c.student_id); setPhoto(null); }} style={styles.coverRow}>
                  <View style={styles.enrollmentInfo}>
                    <Text style={styles.enrollmentName}>{c.name}</Text>
                    <Text style={styles.enrollmentRoll}>{coverageLine(c, recommended)}</Text>
                  </View>
                  <StatusPill label={COVERAGE_LABEL[c.status]} tone={COVERAGE_TONE[c.status]} />
                </TouchableOpacity>
              ))}
              {filterCoverage(coverage.students, filter).length === 0 ? <Text style={styles.tip}>Nobody in this view.</Text> : null}
            </>
          ) : null}
        </View>
      ) : null}

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
                    <Text style={styles.enrollmentName}>{enr.student_name ?? 'Student'}</Text>
                    <Text style={styles.enrollmentRoll}>
                      Roll: {enr.student_roll || '—'}
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
  photoButtons: { alignItems: 'stretch', gap: Spacing.sm, alignSelf: 'stretch' },
  tip: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, minHeight: 52 },
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
