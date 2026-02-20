import React from 'react';
import { Stack } from 'expo-router';
import { Colors, FontSize } from '../../constants/colors';

export default function DriverLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
      }}
    >
      <Stack.Screen name="dashboard" options={{ title: 'Driver Dashboard' }} />
      <Stack.Screen name="journey" options={{ title: 'Active Journey', headerBackVisible: false }} />
    </Stack>
  );
}
