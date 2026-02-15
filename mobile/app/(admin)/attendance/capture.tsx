import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { attendanceApi } from '../../../services/api';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

export default function CaptureAttendance() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const takePhoto = async () => {
    if (cameraRef.current) {
      try {
        const result = await cameraRef.current.takePictureAsync({ quality: 0.8 });
        if (result) {
          setPhoto(result.uri);
        }
      } catch (error) {
        console.error('Failed to take photo:', error);
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

  const uploadPhoto = async () => {
    if (!photo) return;

    setUploading(true);
    try {
      const formData = new FormData();
      const filename = photo.split('/').pop() || 'attendance.jpg';
      formData.append('image', {
        uri: photo,
        type: 'image/jpeg',
        name: filename,
      } as unknown as Blob);

      const uploadRes = await attendanceApi.uploadImageToStorage(formData);
      const imageUrl = uploadRes.data.image_url || uploadRes.data.url;

      await attendanceApi.createUpload({
        image_url: imageUrl,
        date: new Date().toISOString().split('T')[0],
      });

      Alert.alert('Success', 'Attendance photo uploaded. AI is processing it.', [
        { text: 'Review', onPress: () => router.push('/(admin)/attendance/review') },
        { text: 'Take Another', onPress: () => setPhoto(null) },
      ]);
    } catch (error) {
      console.error('Failed to upload:', error);
      Alert.alert('Error', 'Failed to upload attendance photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Permission check
  if (!permission) return <Spinner fullScreen message="Loading camera..." />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          We need camera access to capture attendance photos.
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} />
        <TouchableOpacity style={styles.galleryLink} onPress={pickFromGallery}>
          <Text style={styles.galleryLinkText}>Or pick from gallery</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Preview captured photo
  if (photo) {
    return (
      <View style={styles.container}>
        <Image source={{ uri: photo }} style={styles.preview} />
        <View style={styles.previewActions}>
          <Button
            title="Retake"
            variant="outline"
            onPress={() => setPhoto(null)}
            style={{ flex: 1 }}
          />
          <Button
            title="Upload & Process"
            onPress={uploadPhoto}
            loading={uploading}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  }

  // Camera view
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            Point at the class register or student group
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
  preview: { flex: 1, resizeMode: 'contain' },
  previewActions: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg, backgroundColor: Colors.text },
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, backgroundColor: Colors.background },
  permissionTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  permissionText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xxl },
  galleryLink: { marginTop: Spacing.lg },
  galleryLinkText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500' },
});
