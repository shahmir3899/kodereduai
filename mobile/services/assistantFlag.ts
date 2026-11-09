import Constants from 'expo-constants';

// Aura ships dark in the app, like on the web. A build turns it on with EXPO_PUBLIC_ASSISTANT_ENABLED=true
// (the server still decides per school and per role through /capabilities/).
export function assistantEnabled(): boolean {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return String(process.env.EXPO_PUBLIC_ASSISTANT_ENABLED ?? extra.assistantEnabled ?? 'false').toLowerCase() === 'true';
}
