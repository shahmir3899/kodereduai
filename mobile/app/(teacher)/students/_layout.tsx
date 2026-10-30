import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../../constants/colors';

export default function StudentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Students' }} />
      <Stack.Screen name="[id]" options={{ title: 'Student' }} />
    </Stack>
  );
}
