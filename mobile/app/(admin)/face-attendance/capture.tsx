import { todayString } from '../../../services/attendanceEntry';
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { faceAttendanceApi, classesApi } from '../../../services/api';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import Select from '../../../components/ui/Select';
import { useToast } from '../../../components/ui/Toast';
import { saveFailureMessage } from '../../../services/errorKind';
import { useMasterClasses } from '../../../hooks/useAcademicYear';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

export default function FaceAttendanceCapture() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [selectedDate] = useState(todayString());
  const cameraRef = useRef<CameraView>(null);
  const toast = useToast();
  // Master classes are persisted reference data, so the picker still opens offline. A failed load
  // is shown instead of leaving an empty picker.
  const classesQ = useMasterClasses();
  const classOptions = (classesQ.data ?? []).map((c) => ({
    value: Number(c.id),
    label: `${c.name}${c.section ? ` - ${c.section}` : ''}`,
  }));

  const takePhoto = async () => {
    if (cameraRef.current) {
      try {
        const result = await cameraRef.current.takePictureAsync({ quality: 0.8 });
        if (result) setPhoto(result.uri);
      } catch (error) {
        toast.error('Could not capture the photo. Please try again.');
      }
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  const uploadAndProcess = async () => {
    if (!photo || !selectedClass) {
      toast.error('Choose a class and capture a photo first.');
      return;
    }

    setUploading(true);
    try {
      // Upload image
      const formData = new FormData();
      const filename = photo.split('/').pop() || 'face_attendance.jpg';
      formData.append('image', {
        uri: photo,
        type: 'image/jpeg',
        name: filename,
      } as unknown as Blob);

      const uploadRes = await faceAttendanceApi.uploadImage(formData);
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url;

      // Create session
      const sessionRes = await faceAttendanceApi.createSession({
        class_obj: selectedClass,
        date: selectedDate,
        image_url: imageUrl,
      });

      const sessionId = sessionRes.data.id;

      Alert.alert('Processing', 'Faces are being detected and matched.', [
        {
          text: 'View Results',
          onPress: () =>
            router.push(`/(admin)/face-attendance/review?id=${sessionId}`),
        },
        { text: 'Capture Another', onPress: () => setPhoto(null) },
      ]);
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.response?.data?.detail || saveFailureMessage(error, 'Upload failed.'));
    } finally {
      setUploading(false);
    }
  };

  if (!permission) return <Spinner fullScreen message="Loading camera..." />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          We need camera access to capture student group photos.
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} />
        <TouchableOpacity accessibilityRole="button" style={styles.galleryLink} onPress={pickFromGallery}>
          <Text style={styles.galleryLinkText}>Or pick from gallery</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (photo) {
    return (
      <View style={styles.container}>
        {/* Class selector */}
        <View style={styles.classSelector}>
          <Select label="Class" value={selectedClass} options={classOptions} onChange={setSelectedClass}
            placeholder={classesQ.isLoading ? 'Loading classes...' : classesQ.isError ? 'Could not load classes' : 'Select class...'}
            disabled={classesQ.isLoading || classOptions.length === 0} />
          {classesQ.isError ? <Text style={styles.classError} onPress={() => classesQ.refetch()} accessibilityRole="button">Tap to retry</Text> : null}
        </View>

        <Image source={{ uri: photo }} style={styles.preview} />

        <View style={styles.previewActions}>
          <Button
            title="Retake"
            variant="outline"
            onPress={() => setPhoto(null)}
            style={{ flex: 1 }}
          />
          <Button
            title="Process Faces"
            onPress={uploadAndProcess}
            loading={uploading}
            disabled={!selectedClass}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            Point at students for face attendance
          </Text>
        </View>
      </CameraView>
      <View style={styles.controls}>
        <TouchableOpacity accessibilityRole="button" style={styles.galleryBtn} onPress={pickFromGallery}>
          <Text style={styles.galleryBtnText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Take photo" style={styles.captureBtn} onPress={takePhoto}>
          <View style={styles.captureBtnInner} />
        </TouchableOpacity>
        <View style={{ width: 60 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.text },
  camera: { flex: 1 },
  overlay: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
  overlayText: { color: Colors.textInverse, fontSize: FontSize.sm, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
  controls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: Spacing.xxl, backgroundColor: Colors.text },
  captureBtn: { width: 70, height: 70, borderRadius: 35, borderWidth: 4, borderColor: Colors.textInverse, alignItems: 'center', justifyContent: 'center' },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.textInverse },
  galleryBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  galleryBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: '500' },
  preview: { flex: 1, resizeMode: 'contain' as const },
  previewActions: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg, backgroundColor: Colors.text },
  classSelector: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, backgroundColor: Colors.background },
  classError: { color: Colors.errorText, fontSize: FontSize.sm, paddingBottom: Spacing.sm },
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, backgroundColor: Colors.background },
  permissionTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  permissionText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xxl },
  galleryLink: { marginTop: Spacing.lg },
  galleryLinkText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500' },
});
