import React, { createContext, useContext } from 'react';
import { Stack } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import BackButton from './BackButton';
import MenuButton from './MenuButton';
import { Colors, FontSize } from '../../constants/colors';

// The names of the role's visible bottom tabs, provided by the tab layout. A folder that is one of
// them shows the menu button on its first screen; any other folder was opened from the menu or a
// card, so its first screen shows a back arrow.
export const TabNamesContext = createContext<ReadonlySet<string>>(new Set());

export const stackHeaderStyle = {
  headerStyle: { backgroundColor: Colors.surface },
  headerTitleStyle: { fontWeight: '600' as const, fontSize: FontSize.lg },
  headerTintColor: Colors.text,
};

// A folder of screens inside a tab group, with the shared header. Without a _layout.tsx in the
// folder, expo-router hoists each file into the parent tab bar as its own tab ('finance/accounts',
// 'hr/staff', ...), which put 28 extra buttons on the admin bar, so every folder needs one.
// `titles` names the screens; children can add Stack.Screen entries with other options.
export default function RoleStack({ titles = {}, children }: { titles?: Record<string, string>; children?: React.ReactNode }) {
  const tabs = useContext(TabNamesContext);
  // The layout is rendered as its folder's screen in the tab navigator, so this is the folder name.
  const folder = useRoute().name;
  const isTab = tabs.has(folder);
  return (
    <Stack
      screenOptions={({ navigation, route }) => {
        // Only the folder's first screen needs a left button; deeper screens get the stack's own back.
        const isRoot = navigation.getState()?.routes?.[0]?.key === route.key;
        return {
          ...stackHeaderStyle,
          ...(isRoot ? { headerLeft: () => (isTab ? <MenuButton /> : <BackButton />) } : {}),
        };
      }}
    >
      {Object.entries(titles).map(([name, title]) => <Stack.Screen key={name} name={name} options={{ title }} />)}
      {children}
    </Stack>
  );
}
