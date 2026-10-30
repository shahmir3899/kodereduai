import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { lmsApi } from '../../services/api';
import { useCurriculumActions } from '../../hooks/useCurriculum';
import {
  applyPayload, applyResultText, removeTocChapter, removeTocTopic, TOC_POLL_LIMIT_MS, tocCounts, tocImageProblem, tocJobState,
  tocPollDelay, type TocChapter,
} from '../../services/curriculum';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Step = 'start' | 'working' | 'review' | 'preview';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Photograph a book's table of contents and turn it into chapters and topics: the server reads the
// photo (a background job, polled here), the text is checked and corrected here, the server splits
// it into an outline, which can be trimmed before it is added. Nothing is written until "Add".
export default function TocScanSheet({ bookId, visible, onClose }: { bookId: number; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const actions = useCurriculumActions();
  const [step, setStep] = useState<Step>('start');
  const [text, setText] = useState('');
  const [chapters, setChapters] = useState<TocChapter[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  // One key per outline: if the connection drops mid-request and it is sent again, the server
  // answers with the first result instead of adding every chapter twice.
  const key = useRef(`toc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    if (visible) {
      cancelled.current = false;
      setStep('start'); setText(''); setChapters([]); setWarnings([]); setError(null); setBusy(false);
      key.current = `toc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } else cancelled.current = true;
  }, [visible]);

  const pick = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings to photograph the page.' : 'Allow photo access in your phone settings.');
    const result = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = tocImageProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return setError(problem);

    setStep('working');
    try {
      const form = new FormData();
      form.append('image', { uri: asset.uri, name: asset.fileName ?? 'toc.jpg', type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob);
      const job = (await lmsApi.createTocJob(bookId, form)).data as { job_id: string };
      const started = Date.now();
      for (let attempt = 0; !cancelled.current; attempt += 1) {
        if (Date.now() - started > TOC_POLL_LIMIT_MS) throw new Error('Reading the page took too long. Try again with a clearer photo.');
        await sleep(tocPollDelay(attempt));
        const res = (await lmsApi.getTocJob(job.job_id)).data as { status: string; error_message?: string; result?: { text?: string } };
        const state = tocJobState(res.status);
        if (state === 'failed') throw new Error(res.error_message || 'The page could not be read. Try a clearer photo.');
        if (state === 'done') {
          setText(res.result?.text ?? '');
          return setStep('review');
        }
      }
    } catch (e) {
      setStep('start');
      setError((e as { response?: unknown }).response ? inventoryErrorMessage(e, 'Could not read the page.') : (e as Error).message);
    }
  };

  const parse = async () => {
    if (!text.trim()) return setError('There is no text to use. Take the photo again.');
    setBusy(true);
    setError(null);
    try {
      const data = (await lmsApi.parseToc(bookId, { toc_text: text })).data as { chapters: TocChapter[]; warnings?: string[] };
      setChapters(data.chapters ?? []);
      setWarnings(data.warnings ?? []);
      setStep('preview');
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not split the text into chapters.'));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const payload = applyPayload(chapters, key.current);
    if (payload.chapters.length === 0) return setError('Keep at least one chapter.');
    setBusy(true);
    setError(null);
    try {
      const res = await actions.applyToc.mutateAsync({ id: bookId, data: payload });
      toast.success(applyResultText(res.data as { chapters_created?: number; topics_created?: number; errors?: string[] }));
      onClose();
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not add the chapters.'));
    } finally {
      setBusy(false);
    }
  };

  const counts = tocCounts(chapters);
  const title = step === 'review' ? 'Check the text' : step === 'preview' ? 'Check the outline' : 'Scan contents page';

  return (
    <FormSheet
      visible={visible} title={title} onClose={onClose} error={error} busy={busy}
      onSubmit={step === 'review' ? parse : step === 'preview' ? add : onClose}
      submitLabel={step === 'review' ? 'Split into chapters' : step === 'preview' ? `Add ${counts.chapters} chapters, ${counts.topics} topics` : 'Close'}
    >
      {step === 'start' ? (
        <View style={styles.gap}>
          <Text style={styles.hint}>Photograph the table of contents of the book, straight on and in good light. The chapters and topics are read from the page; you check them before anything is added.</Text>
          <Button title="Take a photo" onPress={() => pick(true)} />
          <Button title="Choose from photos" variant="outline" onPress={() => pick(false)} />
        </View>
      ) : null}
      {step === 'working' ? <Text style={styles.hint}>Reading the page… this takes up to a minute. Keep this open.</Text> : null}
      {step === 'review' ? (
        <View style={styles.gap}>
          <Text style={styles.hint}>Fix any misread words. One line per chapter or topic; indent topics under their chapter.</Text>
          <Input value={text} onChangeText={setText} multiline style={styles.text} />
        </View>
      ) : null}
      {step === 'preview' ? (
        <View style={styles.gap}>
          {warnings.map((w) => <Text key={w} style={styles.warn}>{w}</Text>)}
          {chapters.map((c, ci) => (
            <View key={`${ci}-${c.title}`} style={styles.chapter}>
              <View style={styles.row}>
                <Text style={styles.chapterTitle} numberOfLines={2}>{ci + 1}. {c.title}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove chapter ${c.title}`} style={styles.x} onPress={() => setChapters((cs) => removeTocChapter(cs, ci))}><Text style={styles.xText}>✕</Text></TouchableOpacity>
              </View>
              {c.topics.map((t, ti) => (
                <View key={`${ti}-${t.title}`} style={styles.row}>
                  <Text style={styles.topic} numberOfLines={2}>{t.title}</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove topic ${t.title}`} style={styles.x} onPress={() => setChapters((cs) => removeTocTopic(cs, ci, ti))}><Text style={styles.xText}>✕</Text></TouchableOpacity>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { fontSize: FontSize.sm, color: Colors.warning },
  text: { minHeight: 200, textAlignVertical: 'top' },
  chapter: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chapterTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  topic: { flex: 1, fontSize: FontSize.sm, color: Colors.text, paddingLeft: Spacing.md },
  x: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  xText: { color: Colors.error, fontSize: FontSize.lg },
});
