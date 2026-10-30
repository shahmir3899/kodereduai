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
      <Stack.Screen name="index" options={{ title: 'Admissions' }} />
      <Stack.Screen name="[id]" options={{ title: 'Enquiry' }} />
      <Stack.Screen name="conversion-likelihood" options={{ title: 'Conversion Likelihood' }} />
    </Stack>
  );
}
