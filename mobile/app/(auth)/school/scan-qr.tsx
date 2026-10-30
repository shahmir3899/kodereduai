import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { schoolDirectoryApi } from '../../../services/api';
import { setSchoolCode } from '../../../services/auth';
import { lookupFailureText, parseSchoolCode } from '../../../services/schoolFinder';
import Button from '../../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

// Reads a school's QR code. Only a code this app's schools use is accepted (the app link or a
// school web address); any other QR code is refused and scanning carries on.
export default function ScanSchoolQr() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState('Point the camera at your school\'s QR code.');
  const busy = useRef(false);

  const onScan = async ({ data }: { data: string }) => {
    if (busy.current) return;
    const code = parseSchoolCode(data);
    if (!code) { setMessage('That is not a school QR code. Try your school\'s code.'); return; }
    busy.current = true;
    setMessage('Checking the school...');
    try {
      await schoolDirectoryApi.info(code);
      await setSchoolCode(code);
      router.replace('/(auth)/login');
    } catch (e) {
      setMessage(lookupFailureText(e));
      // A short pause so the same code is not retried in a tight loop.
      setTimeout(() => { busy.current = false; }, 2000);
    }
  };

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.textLight}>Allow the camera to scan your school's QR code.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
        <Button title="Back" variant="outline" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      <View style={styles.bar}>
        <Text style={styles.text} accessibilityLiveRegion="polite">{message}</Text>
        <Button title="Back" variant="outline" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md },
  camera: { flex: 1 },
  bar: { backgroundColor: Colors.surface, padding: Spacing.lg, gap: Spacing.md, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl },
  text: { color: Colors.text, fontSize: FontSize.md, textAlign: 'center' },
  textLight: { color: Colors.textInverse, fontSize: FontSize.md, textAlign: 'center' },
});
