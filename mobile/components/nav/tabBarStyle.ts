import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize } from '../../constants/colors';

// A fixed 56px bar sat under the gesture/nav bar on phones with a bottom inset, so the labels were
// clipped. The height now grows with the inset, and the label stays on one line.
export function useTabScreenOptions() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 4);
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
    tabBarLabelStyle: { fontSize: FontSize.xs, fontWeight: '500' as const },
    tabBarAllowFontScaling: false,
  };
}
