import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MoreContent } from './MoreScreen';
import { useSideMenu } from './SideMenuContext';
import Icon from '../ui/Icon';
import { Colors, Spacing } from '../../constants/colors';

const PANEL_MAX = 320;

// The same menu as the More page, as a panel from the left edge (a permanent rail on wide screens).
// It closes itself whenever the screen changes, so any row, the profile or the school switcher
// can navigate without each one knowing about the panel.
export default function SideMenu() {
  const { isOpen, docked, close } = useSideMenu();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(PANEL_MAX, Math.round(width * 0.85));
  const slide = useRef(new Animated.Value(-panelWidth)).current;
  const [mounted, setMounted] = useState(false);
  const path = usePathname();

  useEffect(() => { close(); }, [path, close]);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      slide.setValue(-panelWidth);
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(slide, { toValue: -panelWidth, duration: 180, useNativeDriver: true }).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (docked) {
    return (
      <View style={[styles.rail, { width: PANEL_MAX }]} accessibilityLabel="Menu">
        <MoreContent />
      </View>
    );
  }

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close menu">
          <View style={styles.backdrop} />
        </Pressable>
        <Animated.View style={[styles.panel, { width: panelWidth, transform: [{ translateX: slide }] }]} accessibilityViewIsModal>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left']}>
            <View style={styles.top}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close menu" onPress={close} style={styles.closeBtn}>
                <Icon name="close-outline" size={26} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <MoreContent />
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: Colors.background },
  safe: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.sm },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  rail: { backgroundColor: Colors.background, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: Colors.border },
});
