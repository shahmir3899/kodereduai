import React from 'react';
import { Linking, Text, StyleSheet } from 'react-native';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  onContinue: () => void;
  busy?: boolean;
  // Set when the phone refused: the sheet then points at Settings instead of asking again.
  denied?: boolean;
}

// Shown before the phone's own permission prompt (Google Play requires the reason to be stated
// in the app first). Wording matches docs/ANDROID_BACKGROUND_LOCATION.md.
export default function LocationDisclosure({ visible, onClose, onContinue, busy, denied }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share the bus location">
      <Text style={styles.body}>
        Education AI uses this phone&apos;s location, including while the app is closed or the screen is off, to show
        parents where the school bus is during a journey.
      </Text>
      <Text style={styles.body}>
        • Location is sent only between Start journey and End journey.{'\n'}
        • Only the parents of students on your route can see the bus.{'\n'}
        • A notification stays on screen while it is being shared.
      </Text>
      <Text style={styles.body}>
        On the next screen choose <Text style={styles.bold}>&quot;Allow all the time&quot;</Text> so tracking keeps working when the phone is locked.
      </Text>
      {denied ? (
        <>
          <Text style={styles.warn}>Location is not allowed for the whole journey. Open Settings, then Location, and choose &quot;Allow all the time&quot;.</Text>
          <Button title="Open Settings" onPress={() => Linking.openSettings()} fullWidth size="lg" />
        </>
      ) : (
        <Button title="Continue" onPress={onContinue} loading={busy} fullWidth size="lg" />
      )}
      <Button title="Not now" onPress={onClose} variant="ghost" fullWidth />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: FontSize.md, color: Colors.text, marginBottom: Spacing.md },
  bold: { fontWeight: '700' },
  warn: { fontSize: FontSize.md, color: Colors.error, marginBottom: Spacing.md },
});
