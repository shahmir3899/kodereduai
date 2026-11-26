import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function AssignmentsLayout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Assignments' }} />
      <Stack.Screen name="form" options={{ title: 'Assignment' }} />
      <Stack.Screen name="submissions" options={{ title: 'Submissions' }} />
      <Stack.Screen name="diary" options={{ title: 'Daily diary' }} />
    </RoleStack>
  );
}
