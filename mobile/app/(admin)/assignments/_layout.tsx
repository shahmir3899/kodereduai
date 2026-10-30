import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../../constants/colors';

export default function AssignmentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Assignments' }} />
      <Stack.Screen name="form" options={{ title: 'Assignment' }} />
      <Stack.Screen name="submissions" options={{ title: 'Submissions' }} />
    </Stack>
  );
}
