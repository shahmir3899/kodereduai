import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../../services/api';
import { photoProblem } from '../../services/profile';
import { saveFailureMessage } from '../../services/errorKind';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  staffId: number;
  name: string;
  photoUrl?: string | null;
}

// A staff member's photo: take or choose one (the phone's square crop), or remove it. Admin and
// principal only (the server refuses everyone else). Same limits as the student photo.
export default function StaffPhoto({ staffId, name, photoUrl }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ predicate: (q) => ['hrStaffMember', 'staffDirectory', 'hrStaffAdmin'].includes(q.queryKey[0] as string) });

  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.error(camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.'); return; }
    const options = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.7 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ['images'] });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const mime = a.mimeType ?? 'image/jpeg';
    const bad = photoProblem(mime, a.fileSize);
    if (bad) { toast.error(bad); return; }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', { uri: a.uri, name: a.fileName ?? 'staff.jpg', type: mime } as unknown as Blob);
      await hrApi.uploadStaffPhoto(staffId, body);
      await refresh();
      toast.success('Photo updated.');
    } catch (e) { toast.error(saveFailureMessage(e, 'Could not upload the photo.')); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove photo?', message: 'Their initials will be shown instead.', confirmLabel: 'Remove', destructive: true }))) return;
    setBusy(true);
    try { await hrApi.removeStaffPhoto(staffId); await refresh(); toast.success('Photo removed.'); }
    catch (e) { toast.error(saveFailureMessage(e, 'Could not remove the photo.')); } finally { setBusy(false); }
  };

  return (
    <View style={styles.wrap}>
      <Avatar name={name || '?'} uri={photoUrl} size={88} />
      <Text style={styles.name}>{name}</Text>
      <View style={styles.buttons}>
        <Button title="Take photo" size="sm" variant="outline" onPress={() => pick(true)} disabled={busy} loading={busy} />
        <Button title="Choose photo" size="sm" variant="outline" onPress={() => pick(false)} disabled={busy} />
        {photoUrl ? <Button title="Remove" size="sm" variant="ghost" onPress={remove} disabled={busy} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: Spacing.lg, gap: Spacing.xs },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center', marginTop: Spacing.xs },
});
