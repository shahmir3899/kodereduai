import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Messages' }} />
      <Stack.Screen name="thread" options={{ title: 'Conversation' }} />
      <Stack.Screen name="new" options={{ title: 'New message' }} />
    </RoleStack>
  );
}
