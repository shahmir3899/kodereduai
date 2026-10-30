import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Image, ActivityIndicator } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { schoolDirectoryApi } from '../../../services/api';
import { setSchoolCode } from '../../../services/auth';
import { filterDirectory, lookupFailureText, parseSchoolCode, searchHint, type PublicSchool } from '../../../services/schoolFinder';
import { useSchoolDirectory } from '../../../hooks/useSchoolFinder';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Avatar from '../../../components/ui/Avatar';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

// First screen on a new phone: pick your school by name, by code, or by scanning its QR code. The
// code is only a front door: it chooses which school's page to show before sign-in.
export default function FindSchool() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const directory = useSchoolDirectory();
  // Filtering happens on the phone, so every keystroke answers at once.
  const matches = useMemo(() => filterDirectory(directory.data ?? [], text), [directory.data, text]);

  const choose = async (c: string) => {
    await setSchoolCode(c);
    router.replace('/(auth)/login');
  };

  const useCode = async () => {
    const parsed = parseSchoolCode(code);
    if (!parsed) return setError('Enter the school code, for example demo.');
    setError(null);
    setLooking(true);
    try {
      await schoolDirectoryApi.info(parsed);
      await choose(parsed);
    } catch (e) {
      setError(lookupFailureText(e));
    } finally {
      setLooking(false);
    }
  };

  const hint = directory.data ? searchHint(text, directory.data.length) : '';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Image source={require('../../../assets/icon.png')} style={styles.logo} accessibilityLabel="Education AI" />
        <Text style={styles.title}>Find your school</Text>
        <Text style={styles.sub}>Search for your school, or use its code or QR code.</Text>

        <Input label="School name or code" value={text} onChangeText={setText} placeholder="e.g. Oakwood" autoCapitalize="none" autoCorrect={false} />
        {directory.isLoading ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.md }} accessibilityLabel="Loading schools" /> : null}
        {directory.isError && !directory.data ? (
          <View style={styles.retryBox} accessibilityRole="alert">
            <Text style={styles.error}>{lookupFailureText(directory.error)}</Text>
            <Button title="Try again" size="sm" variant="outline" onPress={() => directory.refetch()} />
          </View>
        ) : null}
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {directory.data && text.trim() && matches.length === 0 && directory.data.length > 0 ? (
          <Text style={styles.hint}>No listed school matches. If your school did not appear, enter its code below.</Text>
        ) : null}
        {matches.map((s: PublicSchool) => (
          <TouchableOpacity key={s.subdomain} accessibilityRole="button" accessibilityLabel={`${s.name}. Choose this school`} style={styles.row} onPress={() => choose(s.subdomain)}>
            <Avatar name={s.name} uri={s.logo} size={48} />
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={2}>{s.name}</Text>
              <Text style={styles.code} numberOfLines={1}>{s.subdomain}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <View style={styles.divider}><Text style={styles.dividerText}>or</Text></View>

        <Input label="I have a school code" value={code} onChangeText={setCode} placeholder="e.g. demo" autoCapitalize="none" autoCorrect={false} onSubmitEditing={useCode} returnKeyType="go" />
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title="Continue with this code" onPress={useCode} loading={looking} disabled={!code.trim() || looking} fullWidth />
        <Button title="Scan my school's QR code" variant="outline" fullWidth onPress={() => router.push('/(auth)/school/scan-qr' as Href)} />

        <TouchableOpacity accessibilityRole="button" style={styles.skip} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.skipText}>Skip, sign in without choosing a school</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xxl, gap: Spacing.md, flexGrow: 1, justifyContent: 'center' },
  logo: { width: 72, height: 72, borderRadius: BorderRadius.lg, alignSelf: 'center' },
  title: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  error: { fontSize: FontSize.sm, color: Colors.error },
  retryBox: { gap: Spacing.sm, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, minHeight: 64 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  code: { fontSize: FontSize.sm, color: Colors.textSecondary },
  divider: { alignItems: 'center', marginVertical: Spacing.sm },
  dividerText: { color: Colors.textTertiary, fontSize: FontSize.sm },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
