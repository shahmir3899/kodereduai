import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function AttendanceLayout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Attendance' }} />
      <Stack.Screen name="manual" options={{ title: 'Mark Attendance' }} />
      <Stack.Screen name="register" options={{ title: 'Attendance Record' }} />
      <Stack.Screen name="anomalies" options={{ title: 'Attendance Anomalies' }} />
      {/* Register-photo OCR is parked (OCR_ENABLED=false): the screens stay but nothing links here. */}
      <Stack.Screen name="capture" options={{ title: 'Capture' }} />
      <Stack.Screen name="review" options={{ title: 'Review' }} />
    </RoleStack>
  );
}
