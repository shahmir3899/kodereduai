import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from '../../constants/colors';
import { useAuth } from '../../contexts/AuthContext';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { assistantApi } from '../../services/assistantApi';
import { assistantEnabled } from '../../services/assistantFlag';

// Floating entry point, mounted once in RoleGuard so every role shell gets it. It asks the server what Aura
// can do for THIS person and shows nothing when the answer is empty (drivers, a school with Aura off).
export default function AuraLauncher() {
  const { isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const on = assistantEnabled() && isAuthenticated;
  const caps = useScopedQuery<any>('assistant-capabilities', [], async () => (await assistantApi.capabilities()).data, {
    enabled: on, staleTime: 5 * 60 * 1000, retry: false,
  });
  if (!on || !(caps.data?.agents?.length > 0) || pathname.startsWith('/aura')) return null;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel="Open Aura assistant"
      onPress={() => router.push('/aura')}
      style={[styles.fab, { bottom: insets.bottom + 84 }]}
    >
      <Text style={styles.text}>Aura</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: Spacing.lg, minWidth: 56, height: 56, borderRadius: 28, paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center', elevation: 6,
    shadowColor: Colors.shadow, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  text: { color: Colors.textInverse, fontWeight: '700' },
});
