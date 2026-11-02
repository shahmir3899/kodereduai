import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { examinationsApi } from '../../services/api';
import {
  applyExtraction, captureImageProblem, dropPage, hasExtractedPage, isTerminal, markFailed, marksNudge, pageLabel, POLL_MS, registerPage, removeReview,
  removeSection, updateReview, validateReview, type CaptureState, type Upload,
} from '../../services/paperCapture';
import { QUESTION_TYPES, typeLabel } from '../../services/questionBank';
import { appendFile } from '../../services/formFile';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import SectionsEditor from './SectionsEditor';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const POLL_LIMIT_MS = 180_000;

interface Props {
  kind: 'paper' | 'worksheet';
  visible: boolean;
  onClose: () => void;
  classId: number | null;
  subjectId: number | null;
  // The capture lives in the builder, so closing this sheet keeps it until it is accepted or started over.
  capture: CaptureState;
  setCapture: React.Dispatch<React.SetStateAction<CaptureState>>;
  // Hand the reviewed capture to the builder. Resolve when done; reject with a message to keep the sheet open.
  onAccept: (c: CaptureState) => Promise<void>;
}

// Photograph a printed paper or worksheet, page by page. Each photo is read by the server in the background; the
// sections and questions it finds are reviewed and edited here, and nothing is added to the builder until "Accept".
export default function PaperCaptureSheet({ kind, visible, onClose, classId, subjectId, capture, setCapture, onAccept }: Props) {
  const toast = useToast();
  const [stage, setStage] = useState<'idle' | 'uploading' | 'reading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retryPage = useRef<number | null>(null);
  const gone = useRef(false);
  // Reset on mount too: in development React mounts, unmounts and mounts again, which would leave the flag set.
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);

  const noun = kind === 'paper' ? 'paper' : 'worksheet';
  const uploadFn = kind === 'paper' ? examinationsApi.uploadPaperImage : examinationsApi.uploadWorksheetImage;
  const getFn = kind === 'paper' ? examinationsApi.getPaperUpload : examinationsApi.getWorksheetUpload;

  const pick = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings to photograph the page.' : 'Allow photo access in your phone settings.');
    const result = camera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = captureImageProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return setError(problem);

    setStage('uploading');
    try {
      const form = new FormData();
      await appendFile(form, 'image', { uri: asset.uri, name: asset.fileName ?? 'page.jpg', type: asset.mimeType ?? 'image/jpeg' });
      if (classId) form.append('class_obj', String(classId));
      if (subjectId) form.append('subject', String(subjectId));
      if (capture.groupId) form.append('group_id', capture.groupId);
      if (retryPage.current) form.append('page_number', String(retryPage.current));
      retryPage.current = null;
      const upload = (await uploadFn(form)).data as Upload;
      setCapture((c) => registerPage(c, upload));
      setStage('reading');
      const started = Date.now();
      for (let attempt = 0; !gone.current; attempt += 1) {
        if (Date.now() - started > POLL_LIMIT_MS) throw new Error('Reading the page took too long. Try again with a clearer photo.');
        await sleep(POLL_MS);
        const res = (await getFn(upload.id)).data as Upload;
        if (!isTerminal(res.status)) continue;
        if (res.status === 'FAILED') setCapture((c) => markFailed(c, upload.id, res.error_message || ''));
        else setCapture((c) => applyExtraction(c, res));
        break;
      }
    } catch (e) {
      setError((e as { response?: unknown }).response ? inventoryErrorMessage(e, 'Could not upload the photo.') : (e as Error).message);
    } finally {
      if (!gone.current) setStage('idle');
    }
  };

  const retry = (pageNumber: number) => {
    retryPage.current = pageNumber;
    setCapture((c) => dropPage(c, pageNumber));
  };

  const startOver = async () => {
    if (!(await confirm({ title: 'Start over?', message: 'The pages and everything you edited here are discarded.', confirmLabel: 'Start over', destructive: true }))) return;
    setCapture((c) => ({ ...c, groupId: null, pages: [], sections: [], questions: [] }));
    retryPage.current = null;
    setError(null);
  };

  const accept = async () => {
    const problem = validateReview(capture);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      await onAccept(capture);
      toast.success(`Added to the ${noun}.`);
      onClose();
    } catch (e) {
      setError((e as Error).message || `Could not add this to the ${noun}.`);
    } finally {
      setBusy(false);
    }
  };

  const working = stage !== 'idle';
  const last = capture.pages[capture.pages.length - 1];
  const failed = last?.status === 'failed';
  const nudge = marksNudge(capture);
  const groups = capture.sections.filter((s) => s.type !== 'divider');
  const first = capture.pages.length === 0;

  return (
    <FormSheet visible={visible} title={`Capture the ${noun} from photos`} onClose={onClose} onSubmit={hasExtractedPage(capture) ? accept : onClose}
      submitLabel={hasExtractedPage(capture) ? `Add ${capture.questions.length} question${capture.questions.length === 1 ? '' : 's'} to the ${noun}` : 'Close'} busy={busy} error={error}>
      {first ? (
        <Text style={styles.hint}>Photograph the printed {noun}, straight on and in good light. The sections and questions are read from the page; you check and fix them before anything is added. For more than one page, add them one at a time.</Text>
      ) : null}

      {capture.pages.length > 0 ? (
        <View style={styles.strip}>
          {capture.pages.map((p) => (
            <View key={p.pageNumber} style={styles.pageRow}>
              <Text style={styles.name}>Page {p.pageNumber}</Text>
              <StatusPill label={pageLabel(p)} tone={p.status === 'failed' ? 'error' : p.status === 'extracted' ? 'success' : 'info'} />
              {p.status === 'failed' ? <Button title="Retry" size="sm" variant="outline" onPress={() => retry(p.pageNumber)} /> : null}
            </View>
          ))}
          {failed ? <Text style={styles.problem}>{last.error}</Text> : null}
        </View>
      ) : null}

      {working ? <Text style={styles.hint}>{stage === 'uploading' ? 'Uploading the photo…' : 'Reading the page… this takes up to a minute. You can close this and keep working; it will be here when it is done.'}</Text> : (
        <View style={styles.gap}>
          <Button title={first || failed ? 'Take a photo' : '+ Add the next page (photo)'} onPress={() => pick(true)} />
          <Button title="Choose from photos" variant="outline" onPress={() => pick(false)} />
        </View>
      )}

      {hasExtractedPage(capture) ? (
        <View style={styles.gap}>
          {nudge ? <Text style={styles.hint}>{nudge}</Text> : null}
          {kind === 'paper' ? (
            <>
              <Input label="Paper title" value={capture.header.title} onChangeText={(v) => setCapture((c) => ({ ...c, header: { ...c.header, title: v } }))} />
              <Input label="Duration (minutes)" value={capture.header.duration} onChangeText={(v) => setCapture((c) => ({ ...c, header: { ...c.header, duration: v } }))} keyboardType="number-pad" />
            </>
          ) : null}

          <SectionsEditor
            sections={capture.sections} onChange={(next) => setCapture((c) => ({ ...c, sections: next }))} noun={noun}
            placed={(k) => capture.questions.filter((q) => q.sectionKey === k).length}
            onRemove={(k) => setCapture((c) => removeSection(c, k))}
          />

          <Text style={styles.heading}>Questions · {capture.questions.length}</Text>
          {capture.questions.map((q, i) => (
            <View key={q.localId} style={styles.card}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit question ${i + 1}`} onPress={() => setOpen(open === q.localId ? null : q.localId)}>
                <Text style={styles.sub}>{i + 1}. {typeLabel(q.type)} · {Number(q.marks) || 1} mark{Number(q.marks) === 1 ? '' : 's'}{q.sectionKey ? ` · ${groups.find((g) => g.key === q.sectionKey)?.title ?? ''}` : ''}</Text>
                <Text style={[styles.text, !q.text.trim() && styles.empty]} numberOfLines={open === q.localId ? undefined : 2}>{q.text.trim() || '(empty: fill in or remove)'}</Text>
              </TouchableOpacity>
              {open === q.localId ? (
                <View style={styles.gap}>
                  <Input label="Question" value={q.text} onChangeText={(v) => setCapture((c) => updateReview(c, q.localId, { text: v }))} multiline style={styles.big} />
                  <Select label="Type" value={q.type} onChange={(v) => setCapture((c) => updateReview(c, q.localId, { type: String(v) }))} options={QUESTION_TYPES.map((t) => ({ value: t.value as string, label: t.label }))} />
                  <Input label="Marks" value={q.marks} onChangeText={(v) => setCapture((c) => updateReview(c, q.localId, { marks: v }))} keyboardType="decimal-pad" />
                  {q.type === 'MCQ' ? (['A', 'B', 'C', 'D'] as const).map((l) => (
                    <Input key={l} label={`Option ${l}`} value={q.options[l]} onChangeText={(v) => setCapture((c) => updateReview(c, q.localId, { options: { ...q.options, [l]: v } }))} />
                  )) : null}
                  {groups.length > 0 ? (
                    <Select label="Section" value={q.sectionKey} onChange={(v) => setCapture((c) => updateReview(c, q.localId, { sectionKey: String(v) }))}
                      options={[{ value: '', label: 'No section' }, ...groups.map((g) => ({ value: g.key, label: g.title || 'Section' }))]} />
                  ) : null}
                  <Button title="Remove question" variant="danger" size="sm" onPress={() => setCapture((c) => removeReview(c, q.localId))} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {capture.pages.length > 0 ? <Button title="Start over" variant="ghost" size="sm" onPress={startOver} /> : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  problem: { fontSize: FontSize.sm, color: Colors.errorText },
  strip: { gap: Spacing.xs },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  heading: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: Spacing.xs },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  text: { fontSize: FontSize.md, color: Colors.text },
  empty: { color: Colors.errorText },
  big: { minHeight: 90, textAlignVertical: 'top' },
});
