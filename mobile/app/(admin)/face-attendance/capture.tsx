import React, { useState, useRef, useEffect } from 'react';
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
import { Picker } from '@react-native-picker/picker';
import { faceAttendanceApi, classesApi } from '../../../services/api';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

export default function FaceAttendanceCapture() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedDate] = useState(new Date().toISOString().split('T')[0]);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    loadClasses();
  }, []);

  const loadClasses = async () => {
    try {
      const res = await classesApi.getClasses({ page_size: 100 });
      setClasses(res.data.results || res.data || []);
    } catch (err) {
      console.error('Failed to load classes:', err);
    }
  };

  const takePhoto = async () => {
    if (cameraRef.current) {
      try {
        const result = await cameraRef.current.takePictureAsync({ quality: 0.8 });
        if (result) setPhoto(result.uri);
      } catch (error) {
        Alert.alert('Error', 'Failed to capture photo.');
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
      Alert.alert('Error', 'Please select a class and capture a photo.');
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
        class_obj: parseInt(selectedClass),
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
      const msg = error.response?.data?.error || error.response?.data?.detail || 'Upload failed.';
      Alert.alert('Error', msg);
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
        <TouchableOpacity style={styles.galleryLink} onPress={pickFromGallery}>
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
          <Text style={styles.label}>Class:</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={selectedClass}
              onValueChange={setSelectedClass}
              style={styles.picker}
            >
              <Picker.Item label="Select class..." value="" />
              {classes.map((cls: any) => (
                <Picker.Item
                  key={cls.id}
                  label={`${cls.name}${cls.section ? ` - ${cls.section}` : ''}`}
                  value={String(cls.id)}
                />
              ))}
            </Picker>
          </View>
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
        <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
          <Text style={styles.galleryBtnText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.captureBtn} onPress={takePhoto}>
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
  classSelector: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.background },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginRight: Spacing.sm },
  pickerWrapper: { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md },
  picker: { height: 44 },
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, backgroundColor: Colors.background },
  permissionTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  permissionText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xxl },
  galleryLink: { marginTop: Spacing.lg },
  galleryLinkText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500' },
});
