import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Admissions' }} />
      <Stack.Screen name="[id]" options={{ title: 'Enquiry' }} />
      <Stack.Screen name="conversion-likelihood" options={{ title: 'Conversion Likelihood' }} />
    </RoleStack>
  );
}
