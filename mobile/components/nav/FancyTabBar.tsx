import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize } from '../../constants/colors';

const BAR_HEIGHT = 58;
const BUBBLE = 52;
const ICON_BOX = 30;
const BAR_PAD_TOP = 6;
// How far the selected tab's icon is lifted.
const LIFT = 22;
// How far the selected tab's circle pokes above the bar's top edge. Anything pinned just above the
// tab bar (a form's Save button) leaves this much room, or the circle covers it.
export const TAB_BUBBLE_RISE = LIFT + (BUBBLE - ICON_BOX) / 2 - BAR_PAD_TOP;

// The selected tab is a raised blue circle with a white icon (its label hidden); the rest are an
// icon and a label. Screens with `href: null` are given `display: 'none'` by expo-router, so they
// are skipped here exactly as the stock bar skips them.
export default function FancyTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 4);
  const narrow = useWindowDimensions().width < 340;

  return (
    <View style={[styles.bar, { paddingBottom: bottom, height: BAR_HEIGHT + bottom }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const itemStyle = StyleSheet.flatten(options.tabBarItemStyle) as { display?: string } | undefined;
        if (itemStyle?.display === 'none') return null;
        const focused = state.index === index;
        const label = typeof options.title === 'string' ? options.title : route.name;
        // Emitting tabPress keeps listeners working: the admin More tab opens the side menu from it.
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
        return (
          <TabItem key={route.key} focused={focused} label={label} narrow={narrow}
            icon={options.tabBarIcon} onPress={onPress} onLongPress={onLongPress} />
        );
      })}
    </View>
  );
}

type IconRender = BottomTabBarProps['descriptors'][string]['options']['tabBarIcon'];

function TabItem({ focused, label, narrow, icon, onPress, onLongPress }: {
  focused: boolean; label: string; narrow: boolean; icon: IconRender; onPress: () => void; onLongPress: () => void;
}) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(progress, { toValue: focused ? 1 : 0, useNativeDriver: true, friction: 7, tension: 80 }).start();
  }, [focused, progress]);

  const lift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const labelOpacity = progress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const color = focused ? Colors.textInverse : Colors.textTertiary;

  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}
      onPress={onPress} onLongPress={onLongPress} style={styles.item}>
      <Animated.View style={[styles.iconWrap, { transform: [{ translateY: lift }] }]}>
        <Animated.View style={[styles.bubble, { opacity: progress, transform: [{ scale }] }]} />
        {icon ? icon({ focused, color, size: focused ? 24 : 22 }) : null}
      </Animated.View>
      <Animated.Text allowFontScaling={false} numberOfLines={1}
        style={[styles.label, narrow && styles.labelNarrow, { opacity: labelOpacity }]}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: BAR_PAD_TOP,
    ...Platform.select({
      web: { boxShadow: '0 -2px 12px rgba(15, 23, 42, 0.08)' } as object,
      default: { shadowColor: Colors.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: -2 }, elevation: 12 },
    }),
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', minHeight: 44 },
  iconWrap: { width: BUBBLE, height: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    position: 'absolute',
    width: BUBBLE,
    height: BUBBLE,
    top: (ICON_BOX - BUBBLE) / 2,
    borderRadius: BUBBLE / 2,
    backgroundColor: Colors.primary,
    borderWidth: 4,
    borderColor: Colors.surface,
    ...Platform.select({
      web: { boxShadow: '0 4px 10px rgba(30, 64, 175, 0.35)' } as object,
      default: { shadowColor: Colors.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
    }),
  },
  // 11px at normal widths; at 320px "Attendance" needs 10px to fit its 64px box.
  label: { fontSize: FontSize.xs, fontWeight: '500', color: Colors.textTertiary, marginTop: 2 },
  labelNarrow: { fontSize: FontSize.xxs },
});

// Ionicons pairs: the selected tab shows the filled shape ("home-outline" -> "home").
export function filledIcon<T extends string>(name: T): T {
  return (name.endsWith('-outline') ? name.slice(0, -'-outline'.length) : name) as T;
}
