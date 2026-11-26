import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { schoolDirectoryApi } from '../../../services/api';
import { setSchoolCode } from '../../../services/auth';
import { lookupFailureText, parseSchoolCode } from '../../../services/schoolFinder';
import { searchSchools } from '../../../services/schoolSearch';
import { useSchoolDirectory } from '../../../hooks/useSchoolDirectory';
import Input from '../../../components/ui/Input';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

// First screen on a new phone: pick your school by typing its name or code, or by scanning its QR
// code. The code is only a front door: it chooses which school's page to show before sign-in.
// The school list behind the name search loads quietly in the background and is never shown whole:
// matches appear only once two letters are typed.
export default function FindSchool() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const directory = useSchoolDirectory();
  const matches = useMemo(() => searchSchools(code, directory), [code, directory]);

  const choose = async (c: string) => {
    await setSchoolCode(c);
    router.replace('/(auth)/login');
  };

  const useCode = async () => {
    // A name ("Focus Grammar") is not a code: the best name match stands in for it.
    const parsed = parseSchoolCode(code) ?? matches[0]?.code ?? null;
    if (!parsed) return setError('Type your school name or code, for example demo.');
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
        <Text style={styles.sub}>Type your school's name or code, or scan its QR code.</Text>

        <Input label="School name or code" value={code} onChangeText={(t) => { setCode(t); setError(null); }} placeholder="Enter school name or code" autoCapitalize="none" autoCorrect={false} onSubmitEditing={useCode} returnKeyType="go" />
        {matches.length > 0 ? (
          <View style={styles.matches} accessibilityLabel={`${matches.length} matching school${matches.length === 1 ? '' : 's'}`}>
            {matches.map((s, i) => (
              <TouchableOpacity key={s.code} accessibilityRole="button" accessibilityLabel={`${s.name}, code ${s.code}`}
                style={[styles.match, i > 0 && styles.matchLine]} onPress={() => choose(s.code)}>
                <Avatar name={s.name} uri={s.logo ?? null} size={36} />
                <View style={styles.matchText}>
                  <Text style={styles.matchName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.matchCode} numberOfLines={1}>{s.code}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
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
  matches: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, overflow: 'hidden' },
  match: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, minHeight: 56 },
  matchLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  matchText: { flex: 1 },
  matchName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  matchCode: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
