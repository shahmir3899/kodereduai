import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Assignments' }} />
      <Stack.Screen name="form" options={{ title: 'Assignment draft' }} />
      <Stack.Screen name="diary" options={{ title: 'Daily diary' }} />
    </RoleStack>
  );
}
