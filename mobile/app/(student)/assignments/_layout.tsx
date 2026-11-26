import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Tasks' }} />
      <Stack.Screen name="detail" options={{ title: 'Task' }} />
    </RoleStack>
  );
}
