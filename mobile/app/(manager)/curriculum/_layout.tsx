import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Curriculum' }} />
      <Stack.Screen name="book" options={{ title: 'Book' }} />
      <Stack.Screen name="topic" options={{ title: 'Topic' }} />
    </RoleStack>
  );
}
