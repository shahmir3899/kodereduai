import React, { useState } from 'react';
import { Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { schoolDirectoryApi } from '../../../services/api';
import { setSchoolCode } from '../../../services/auth';
import { lookupFailureText, parseSchoolCode } from '../../../services/schoolFinder';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

// First screen on a new phone: pick your school by its code or by scanning its QR code. The
// code is only a front door: it chooses which school's page to show before sign-in.
export default function FindSchool() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

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

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Image source={require('../../../assets/icon.png')} style={styles.logo} accessibilityLabel="Education AI" />
        <Text style={styles.title}>Find your school</Text>
        <Text style={styles.sub}>Enter your school code, or scan its QR code.</Text>

        <Input label="School code" value={code} onChangeText={setCode} placeholder="e.g. demo" autoCapitalize="none" autoCorrect={false} onSubmitEditing={useCode} returnKeyType="go" />
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
  error: { fontSize: FontSize.sm, color: Colors.error },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
