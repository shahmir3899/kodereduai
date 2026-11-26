import React from 'react';
import { Platform, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { backTarget } from '../../services/headerView';
import Icon from '../ui/Icon';
import { Colors } from '../../constants/colors';

// Header back arrow for screens that are not a bottom tab (opened from the menu, a card or a
// notification). With nothing to go back to (a notification or a link opened the app straight
// onto this screen) it goes to the role's Home instead of doing nothing.
export default function BackButton() {
  const router = useRouter();
  const { persona } = useAuth();
  const onPress = () => {
    const target = backTarget(router.canGoBack(), persona);
    if (target === 'back') router.back();
    else router.replace(target as Href);
  };
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={onPress} style={styles.btn} hitSlop={8}>
      {/* Same shape as the stack's own back arrow on each platform, so every back button matches. */}
      <Icon name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={24} color={Colors.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
