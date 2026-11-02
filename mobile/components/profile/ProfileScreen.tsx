import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { authApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  buildProfilePayload, displayName, photoProblem, profileChanged, profileErrorMessage, profileFormFromUser, validateProfile,
  type ProfileForm,
} from '../../services/profile';
import { saveFailureMessage } from '../../services/errorKind';
import Avatar from '../ui/Avatar';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The signed-in user's own profile for every role: photo (camera or gallery, square crop, upload,
// remove) and name, phone, email. Needs a connection; nothing is kept on the phone.
export default function ProfileScreen() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const saved = profileFormFromUser(user);
  const [form, setForm] = useState<ProfileForm>(saved);
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ProfileForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = profileChanged(form, saved);
  const name = displayName(user);

  const pick = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.');
    // allowsEditing + a 1:1 aspect gives the phone's own square crop screen.
    const options = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.7 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ['images'] });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const mime = a.mimeType ?? 'image/jpeg';
    const bad = photoProblem(mime, a.fileSize);
    if (bad) return setError(bad);
    setBusy('photo');
    try {
      const body = new FormData();
      body.append('file', { uri: a.uri, name: a.fileName ?? 'profile.jpg', type: mime } as unknown as Blob);
      await authApi.uploadProfilePhoto(body);
      await refreshUser();
      toast.success('Photo updated.');
    } catch (e) {
      setError(profileErrorMessage(e, saveFailureMessage(e, 'Could not upload the photo.')));
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove photo?', message: 'Your initials will be shown instead.', confirmLabel: 'Remove', destructive: true }))) return;
    setError(null);
    setBusy('photo');
    try {
      await authApi.removeProfilePhoto();
      await refreshUser();
      toast.success('Photo removed.');
    } catch (e) {
      setError(profileErrorMessage(e, saveFailureMessage(e, 'Could not remove the photo.')));
    } finally { setBusy(null); }
  };

  const save = async () => {
    const problem = validateProfile(form);
    if (problem) return setError(problem);
    setError(null);
    setBusy('save');
    try {
      await authApi.updateProfile(buildProfilePayload(form, saved));
      const next = await refreshUser();
      setForm(profileFormFromUser(next));
      toast.success('Profile saved.');
    } catch (e) {
      setError(profileErrorMessage(e, saveFailureMessage(e)));
    } finally { setBusy(null); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.photo}>
        <Avatar name={name || '?'} uri={user?.profile_photo_url} size={112} />
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.sub}>{user?.role_display || user?.role}  ·  @{user?.username}</Text>
        <View style={styles.photoButtons}>
          <Button title="Take photo" size="sm" variant="outline" onPress={() => pick(true)} disabled={busy !== null} loading={busy === 'photo'} />
          <Button title="Choose photo" size="sm" variant="outline" onPress={() => pick(false)} disabled={busy !== null} />
          {user?.profile_photo_url ? <Button title="Remove" size="sm" variant="ghost" onPress={remove} disabled={busy !== null} /> : null}
        </View>
      </View>

      <Input label="First name" value={form.first_name} onChangeText={set('first_name')} autoCapitalize="words" />
      <Input label="Last name" value={form.last_name} onChangeText={set('last_name')} autoCapitalize="words" />
      <Input label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      <Input label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />

      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <Button title={dirty ? 'Save changes' : 'No changes to save'} onPress={save} loading={busy === 'save'} disabled={!dirty || busy !== null} fullWidth size="lg" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  photo: { alignItems: 'center', marginBottom: Spacing.lg, gap: Spacing.xs },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  photoButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  error: { color: Colors.errorText, fontSize: FontSize.sm, marginBottom: Spacing.md },
});
