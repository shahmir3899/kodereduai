import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function StudentsLayout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Students' }} />
      <Stack.Screen name="[id]" options={{ title: 'Student' }} />
    </RoleStack>
  );
}
