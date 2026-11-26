import React from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import HeaderActions from './HeaderActions';
import FancyTabBar, { filledIcon } from './FancyTabBar';
import Icon, { type IconName } from '../ui/Icon';
import { Colors, FontSize } from '../../constants/colors';

// Shared by every role's tab layout: the raised-circle bar (FancyTabBar handles the bottom inset
// and narrow phones itself) and the header.
export const renderTabBar = (props: BottomTabBarProps) => React.createElement(FancyTabBar, props);

// Outline icon normally, the filled shape when its tab is selected.
export const tabIcon = (name: IconName) => ({ color, focused, size }: { color: string; focused: boolean; size: number }) =>
  React.createElement(Icon, { name: focused ? filledIcon(name) : name, size, color });

export function useTabScreenOptions() {
  return {
    headerStyle: { backgroundColor: Colors.surface },
    headerTitleStyle: { fontWeight: '600' as const, fontSize: FontSize.lg },
    headerTintColor: Colors.text,
    // Year, notification bell and the signed-in user's photo sit at the right of every tab screen's
    // header (the school logo is in More).
    headerRight: () => React.createElement(HeaderActions),
  };
}
