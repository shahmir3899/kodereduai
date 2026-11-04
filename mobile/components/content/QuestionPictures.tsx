import React, { useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuestionActions } from '../../hooks/useQuestionBank';
import { hasPicture, pictureProblem, PICTURE_SLOTS, slotsFor, type PictureSlot, type Question } from '../../services/questionBank';
import { appendPicture, drawingToFile, type PictureFile } from '../../services/diagrams';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import DiagramPad from './DiagramPad';
import { Colors, BorderRadius, FontSize, Spacing } from '../../constants/colors';

interface Props {
  // The question as saved, or null while it is still being written.
  question: Question | null;
  type: string;
  // Called when a picture is added to a question that does not exist yet: saves it first (as the web does) and returns it,
  // or null when it cannot be saved yet (the sheet shows why).
  ensure: () => Promise<Question | null>;
  onChange: (q: Question) => void;
}

// Pictures on a question, as on the web: the question itself, each option of a multiple choice question, and the model
// answer. Each can be picked from the gallery, taken with the camera, or drawn on the same pad the web has.
export default function QuestionPictures({ question, type, ensure, onChange }: Props) {
  const toast = useToast();
  const actions = useQuestionActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [drawFor, setDrawFor] = useState<PictureSlot | null>(null);

  const upload = async (slot: PictureSlot, file: PictureFile) => {
    setBusy(slot);
    try {
      const q = question ?? await ensure();
      if (!q) return;
      const form = new FormData();
      form.append('slot', slot);
      await appendPicture(form, 'file', file);
      const res = (await actions.uploadPicture.mutateAsync({ id: q.id, form })).data as Record<string, string>;
      const field = Object.keys(res).find((k) => k.endsWith('_image_url'));
      onChange(field ? { ...q, [field]: res[field] } : q);
      toast.success('Picture added.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not upload the picture.'));
    } finally {
      setBusy(null);
    }
  };

  const take = async (slot: PictureSlot, camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error(camera ? 'Allow camera access in your phone settings.' : 'Allow photo access in your phone settings.');
    const options = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 0.8 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = pictureProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return toast.error(problem);
    await upload(slot, { uri: asset.uri, name: asset.fileName ?? `${slot}.jpg`, mime: asset.mimeType ?? 'image/jpeg' });
  };

  const drawn = async (dataUrl: string) => {
    const slot = drawFor;
    setDrawFor(null);
    if (!slot) return;
    const file = await drawingToFile(dataUrl, slot);
    if (!file) return toast.error('Could not use the drawing.');
    await upload(slot, file);
  };

  const drop = async (slot: PictureSlot) => {
    if (!question) return;
    setBusy(slot);
    try {
      await actions.removePicture.mutateAsync({ id: question.id, slot });
      const field = PICTURE_SLOTS.find((x) => x.slot === slot)?.field;
      if (field) onChange({ ...question, [field]: null });
      toast.success('Picture removed.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not remove the picture.'));
    } finally {
      setBusy(null);
    }
  };

  const slots = slotsFor(type);
  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>Pictures (JPEG, PNG or WebP, up to 5 MB) or draw one</Text>
      {slots.map((sl) => {
        const url = question ? (question[sl.field] as string | null | undefined) : null;
        return (
          <View key={sl.slot} style={styles.slot}>
            <View style={styles.head}>
              <Text style={styles.label}>{sl.label}{hasPicture(question, sl.slot) ? ' ✓' : ''}</Text>
              {url ? <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" accessibilityLabel={`${sl.label} preview`} /> : null}
            </View>
            <View style={styles.actions}>
              <Button title="Gallery" size="sm" variant="outline" onPress={() => take(sl.slot, false)} loading={busy === sl.slot} disabled={busy !== null} />
              {Platform.OS !== 'web' ? <Button title="Camera" size="sm" variant="outline" onPress={() => take(sl.slot, true)} disabled={busy !== null} /> : null}
              <Button title="Draw" size="sm" variant="outline" onPress={() => setDrawFor(sl.slot)} disabled={busy !== null} />
              {hasPicture(question, sl.slot) ? <Button title="Remove" size="sm" variant="ghost" onPress={() => drop(sl.slot)} disabled={busy !== null} /> : null}
            </View>
          </View>
        );
      })}
      <DiagramPad visible={drawFor !== null} target={PICTURE_SLOTS.find((s) => s.slot === drawFor)?.label ?? ''} onClose={() => setDrawFor(null)} onDone={drawn} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  slot: { gap: Spacing.xs, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, flex: 1 },
  thumb: { width: 64, height: 64, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
});
