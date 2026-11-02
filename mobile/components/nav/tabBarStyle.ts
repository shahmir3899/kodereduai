import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderActions from './HeaderActions';
import { Colors, FontSize } from '../../constants/colors';

// A fixed 56px bar sat under the gesture/nav bar on phones with a bottom inset, so the labels were
// clipped. The height now grows with the inset, and the label stays on one line.
export function useTabScreenOptions() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 4);
  const narrow = useWindowDimensions().width < 340;
  return {
    headerStyle: { backgroundColor: Colors.surface },
    headerTitleStyle: { fontWeight: '600' as const, fontSize: FontSize.lg },
    headerTintColor: Colors.text,
    tabBarActiveTintColor: Colors.primary,
    tabBarInactiveTintColor: Colors.textTertiary,
    tabBarStyle: {
      backgroundColor: Colors.surface,
      borderTopColor: Colors.border,
      paddingBottom: bottom,
      paddingTop: 4,
      height: 52 + bottom,
    },
    // At 320px wide each of five tabs is 64px and "Attendance" at 11px came out 3px too wide for
    // its box (it was cut with an ellipsis), so the label drops to 10px on the narrowest phones.
    tabBarLabelStyle: { fontSize: narrow ? 10 : FontSize.xs, fontWeight: '500' as const },
    tabBarAllowFontScaling: false,
    // Year, notification bell and the signed-in user's photo sit at the right of every tab screen's
    // header (the school logo is in More).
    headerRight: () => React.createElement(HeaderActions),
  };
}
