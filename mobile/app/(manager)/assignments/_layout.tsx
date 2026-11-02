import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../../constants/colors';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Assignments' }} />
      <Stack.Screen name="form" options={{ title: 'Assignment draft' }} />
      <Stack.Screen name="diary" options={{ title: 'Daily diary' }} />
    </Stack>
  );
}
