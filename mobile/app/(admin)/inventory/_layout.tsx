import RoleStack from '../../../components/nav/RoleStack';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <RoleStack>
      <Stack.Screen name="index" options={{ title: 'Inventory' }} />
      <Stack.Screen name="items" options={{ title: 'Items' }} />
      <Stack.Screen name="lists" options={{ title: 'Categories & Vendors' }} />
      <Stack.Screen name="transactions" options={{ title: 'Stock Movements' }} />
      <Stack.Screen name="assignments" options={{ title: 'Assignments' }} />
      <Stack.Screen name="reorder-prediction" options={{ title: 'Reorder Prediction' }} />
    </RoleStack>
  );
}
