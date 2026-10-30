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
      <Stack.Screen name="index" options={{ title: 'My Children' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Child' }} />
      <Stack.Screen name="[id]/attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="[id]/fees" options={{ title: 'Fees' }} />
      <Stack.Screen name="[id]/timetable" options={{ title: 'Timetable' }} />
      <Stack.Screen name="[id]/exam-schedule" options={{ title: 'Exam Schedule' }} />
      <Stack.Screen name="[id]/results" options={{ title: 'Results' }} />
      <Stack.Screen name="[id]/library" options={{ title: 'Library' }} />
      <Stack.Screen name="[id]/transport" options={{ title: 'Transport' }} />
      <Stack.Screen name="[id]/track" options={{ title: 'Track Bus' }} />
    </Stack>
  );
}
