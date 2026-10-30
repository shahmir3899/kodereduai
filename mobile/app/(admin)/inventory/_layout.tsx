import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../../constants/colors';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Inventory' }} />
      <Stack.Screen name="items" options={{ title: 'Items' }} />
      <Stack.Screen name="transactions" options={{ title: 'Stock Movements' }} />
      <Stack.Screen name="assignments" options={{ title: 'Assignments' }} />
      <Stack.Screen name="reorder-prediction" options={{ title: 'Reorder Prediction' }} />
    </Stack>
  );
}
