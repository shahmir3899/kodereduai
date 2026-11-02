import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The "Switch school" sheet, shared by the dashboards' school name and the side menu's school block.
export function SchoolSwitchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, activeSchool, switchSchool } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const schools = user?.schools ?? [];

  const pick = async (id: number) => {
    if (id === activeSchool?.id) {
      onClose();
      return;
    }
    setSwitchingId(id);
    try {
      await switchSchool(id);
      onClose();
      // The new school may give this user a different role, so re-route from the top.
      router.replace('/');
    } catch (error: any) {
      // A toast, not Alert.alert: Alert shows nothing on the web build.
      toast.error(error?.response?.data?.error || 'Could not switch school. Please try again.');
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={() => switchingId === null && onClose()}>
        <Pressable style={styles.sheet} accessible={false}>
          <Text style={styles.sheetTitle}>Switch school</Text>
          {schools.map((school) => {
            const active = school.id === activeSchool?.id;
            return (
              <TouchableOpacity accessibilityRole="button"
                key={school.id}
                style={[styles.row, active && styles.rowActive]}
                disabled={switchingId !== null}
                onPress={() => pick(school.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowText, active && styles.rowTextActive]}>{school.name}</Text>
                  <Text style={styles.roleText}>{school.role.replace(/_/g, ' ').toLowerCase()}</Text>
                </View>
                {switchingId === school.id
                  ? <ActivityIndicator color={Colors.primary} />
                  : active && <Text style={styles.tick}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Shows the active school's name; a user with more than one school can tap it to switch.
export default function SchoolSwitcher() {
  const { user, activeSchool } = useAuth();
  const [open, setOpen] = useState(false);
  const schools = user?.schools ?? [];
  const name = activeSchool?.name || user?.school_name || '';
  if (!name) return null;
  if (schools.length <= 1) return <Text style={styles.plain}>{name}</Text>;
  return (
    <>
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText} numberOfLines={1}>{name}</Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>
      <SchoolSwitchSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  plain: { fontSize: FontSize.sm, color: Colors.textSecondary },
  button: { flexDirection: 'row', alignItems: 'center', maxWidth: 220 },
  buttonText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', flexShrink: 1 },
  chevron: { fontSize: FontSize.sm, color: Colors.primary, marginLeft: Spacing.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', padding: Spacing.xxl },
  sheet: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, padding: Spacing.lg, paddingTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  rowActive: { backgroundColor: Colors.infoLight },
  rowText: { fontSize: FontSize.md, color: Colors.text },
  rowTextActive: { color: Colors.primary, fontWeight: '600' },
  roleText: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'capitalize', marginTop: 2 },
  tick: { fontSize: FontSize.lg, color: Colors.primary, fontWeight: '700' },
});
