import React from 'react';
import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  // 'center' opens a box in the middle of the screen instead of a panel from the bottom. Used by
  // the academic year picker so it opens where the school switcher does.
  placement?: 'bottom' | 'center';
}

// Slide-up panel for pickers and short forms (or a centred box with `placement="center"`).
// Tapping the dim area closes it.
export default function BottomSheet({ visible, onClose, title, children, placement = 'bottom' }: BottomSheetProps) {
  const center = placement === 'center';
  return (
    <Modal visible={visible} transparent animationType={center ? 'fade' : 'slide'} onRequestClose={onClose} accessibilityViewIsModal>
      {/* The close tap-area is a sibling of the sheet: wrapped around it, every button in the sheet sat inside a button on web. */}
      <View style={[styles.backdrop, center && styles.backdropCenter]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, center && styles.sheetCenter]}>
          {center ? null : <View style={styles.handle} />}
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingBottom: Spacing.xxl,
    maxHeight: '80%',
  },
  // Same box as the school switcher (components/nav/SchoolSwitcher.tsx).
  backdropCenter: { justifyContent: 'center', padding: Spacing.xxl },
  sheetCenter: { borderRadius: BorderRadius.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
});
