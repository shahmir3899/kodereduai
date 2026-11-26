import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function StudentsLayout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Students' }} />
      <Stack.Screen name="new" options={{ title: 'Add student' }} />
      <Stack.Screen name="deleted" options={{ title: 'Recently deleted' }} />
      <Stack.Screen name="[id]" options={{ title: 'Student' }} />
      <Stack.Screen name="[id]/edit" options={{ title: 'Edit student' }} />
    </RoleStack>
  );
}
