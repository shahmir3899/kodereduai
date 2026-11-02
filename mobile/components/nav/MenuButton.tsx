import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useSideMenu } from './SideMenuContext';
import Icon from '../ui/Icon';
import { Colors } from '../../constants/colors';

// Header button that opens the side menu. Not shown when the menu is a permanent rail.
export default function MenuButton() {
  const { docked, open } = useSideMenu();
  if (docked) return null;
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open menu" onPress={open} style={styles.btn}>
      <Icon name="menu-outline" size={26} color={Colors.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
