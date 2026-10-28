import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../../constants/colors';

export default function AttendanceLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Attendance' }} />
      <Stack.Screen name="manual" options={{ title: 'Mark Attendance' }} />
      <Stack.Screen name="register" options={{ title: 'Attendance Record' }} />
      {/* Register-photo OCR is parked (OCR_ENABLED=false): the screens stay but nothing links here. */}
      <Stack.Screen name="capture" options={{ title: 'Capture' }} />
      <Stack.Screen name="review" options={{ title: 'Review' }} />
    </Stack>
  );
}
