import React from 'react';
import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../constants/colors';

// A folder of screens inside a tab. Without a _layout.tsx in the folder, expo-router hoists each
// file into the parent tab bar as its own tab ('finance/accounts', 'hr/staff', ...), which put 28
// extra buttons on the admin bar. Every folder under a tab group needs one of these.
export default function FolderStack({ titles }: { titles: Record<string, string> }) {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      {Object.entries(titles).map(([name, title]) => <Stack.Screen key={name} name={name} options={{ title }} />)}
    </Stack>
  );
}
