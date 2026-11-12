import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { examinationsApi } from '../../services/api';
import { captureImageProblem, type CaptureState } from '../../services/paperCapture';
import {
  buildReview, changeQuestionType, clampPages, emptyPagesSession, missingBeforeAccept, needsCheck, newGroupId, POLL_MS, slotState, SLOT_LABEL,
  toCaptureState, UPLOAD_CONCURRENCY, MAX_PAGES, type GroupStatus, type PagesSession, type PhotoBox,
} from '../../services/paperPages';
import { allocatedMarks } from '../../services/paperBuilder';
import { QUESTION_TYPES, typeLabel } from '../../services/questionBank';
import { plainText } from '../../services/richText';
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
import PaperPhotoViewer from './PaperPhotoViewer';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type LocalState = 'queued' | 'uploading' | 'failed';
type Step = 1 | 2 | 3;

interface Props {
  visible: boolean;
  onClose: () => void;
  classId: number | null;
  subjectId: number | null;
  // Lives in the builder so closing the sheet keeps the capture until it is accepted or started over.
  session: PagesSession;
  setSession: React.Dispatch<React.SetStateAction<PagesSession>>;
  // Hand the reviewed paper to the builder. Resolve when done; reject with a message to keep the sheet open.
  onAccept: (c: CaptureState) => Promise<void>;
}

// Photograph a printed paper: say how many pages it has, add every page (they are read at the same time), then review
// what was read in the order it arrives: the questions and their types, the sections built from them, the paper details.
export default function PaperPagesSheet({ visible, onClose, classId, subjectId, session, setSession, onAccept }: Props) {
  const toast = useToast();
  const [countInput, setCountInput] = useState('1');
  const [locals, setLocals] = useState<Record<number, { state: LocalState; error?: string }>>({});
  const [step, setStep] = useState<Step>(1);
  // The page photo opened from a question's "View photo" button.
  const [viewer, setViewer] = useState<{ page: number; box: PhotoBox | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Array<{ page: number; asset: ImagePicker.ImagePickerAsset }>>([]);
  const active = useRef(0);
  const groupRef = useRef<string | null>(session.groupId);
  groupRef.current = session.groupId;

  const { groupId, totalPages, review } = session;
  const inFlightLocally = Object.values(locals).some((l) => l.state === 'queued' || l.state === 'uploading');

  const status = useQuery({
    queryKey: ['paper-group-status', groupId, totalPages],
    enabled: !!groupId && !!totalPages && !review,
    queryFn: async () => (await examinationsApi.getPaperGroupStatus(groupId as string, totalPages as number)).data as GroupStatus,
    refetchInterval: (q) => ((q.state.data?.pages ?? []).some((p) => p.status === 'PENDING' || p.status === 'PROCESSING') || inFlightLocally ? POLL_MS : false),
  });
  const serverPages = status.data?.pages ?? [];

  // Every declared page is read: the joined paper becomes the review (once).
  useEffect(() => {
    const data = status.data;
    if (review || !data?.complete || !data.result) return;
    setSession((s) => (s.review ? s : { ...s, review: buildReview(
      data.result as NonNullable<GroupStatus['result']>,
      data.pages.map((p) => p.upload_id).filter((x): x is number => !!x),
      data.pages.filter((p) => !!p.image_url).map((p) => ({ page_number: p.page_number, image_url: p.image_url as string })),
    ) }));
    setStep(1);
  }, [status.data, review, setSession]);

  const setLocal = useCallback((page: number, v: { state: LocalState; error?: string } | null) => {
    setLocals((prev) => {
      const next = { ...prev };
      if (v) next[page] = v; else delete next[page];
      return next;
    });
  }, []);

  const pump = useCallback(() => {
    while (active.current < UPLOAD_CONCURRENCY && queue.current.length > 0) {
      const { page, asset } = queue.current.shift() as { page: number; asset: ImagePicker.ImagePickerAsset };
      active.current += 1;
      setLocal(page, { state: 'uploading' });
      (async () => {
        try {
          const form = new FormData();
          await appendFile(form, 'image', { uri: asset.uri, name: asset.fileName ?? `page-${page}.jpg`, type: asset.mimeType ?? 'image/jpeg' });
          if (classId) form.append('class_obj', String(classId));
          if (subjectId) form.append('subject', String(subjectId));
          form.append('group_id', groupRef.current as string);
          form.append('page_number', String(page));
          await examinationsApi.uploadPaperImage(form);
          setLocal(page, null);
          status.refetch();
        } catch (e) {
          setLocal(page, { state: 'failed', error: (e as { response?: unknown }).response ? inventoryErrorMessage(e, 'Could not upload the photo.') : (e as Error).message });
        } finally {
          active.current -= 1;
          pump();
        }
      })();
    }
  }, [classId, subjectId, setLocal, status]);

  const pick = async (page: number, camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings to photograph the page.' : 'Allow photo access in your phone settings.');
    const result = camera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = captureImageProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return setError(problem);
    setLocal(page, { state: 'queued' });
    queue.current.push({ page, asset });
    pump();
  };

  const start = () => {
    const count = clampPages(countInput);
    setSession({ groupId: newGroupId(), totalPages: count, review: null });
  };

  const startOver = async () => {
    if (!(await confirm({ title: 'Start over?', message: 'The pages and everything you edited here are discarded.', confirmLabel: 'Start over', destructive: true }))) return;
    queue.current = [];
    setLocals({});
    setSession(emptyPagesSession());
    setStep(1);
    setError(null);
  };

  const accept = async () => {
    if (!review) return onClose();
    const missing = missingBeforeAccept(review);
    if (missing.length) return setError(`Fill in: ${missing.join(', ')}.`);
    if (!classId || !subjectId) return setError('Choose the class and subject on the paper screen first. Your pages are kept here.');
    setError(null);
    setBusy(true);
    try {
      await onAccept(toCaptureState(review));
      toast.success('Added to the paper.');
      setSession(emptyPagesSession());
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Could not add this to the paper.');
    } finally {
      setBusy(false);
    }
  };

  const patch = (p: Partial<NonNullable<PagesSession['review']>>) => setSession((s) => (s.review ? { ...s, review: { ...s.review, ...p } } : s));
  const groups = (review?.sections ?? []).filter((s) => s.type !== 'divider');

  // ─── 1. how many pages ───
  if (!totalPages) {
    return (
      <FormSheet visible={visible} title="Capture the paper from photos" onClose={onClose} onSubmit={start} submitLabel="Continue" error={error}>
        <Text style={styles.hint}>How many pages does the printed paper have? Say it now so we know when the whole paper has been read. You can then add all the pages together.</Text>
        <Input label={`Total pages (1 to ${MAX_PAGES})`} value={countInput} onChangeText={setCountInput} keyboardType="number-pad" />
      </FormSheet>
    );
  }

  // ─── 2. add the pages ───
  if (!review) {
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    const read = pages.filter((n) => slotState(locals[n]?.state, serverPages.find((p) => p.page_number === n)) === 'extracted').length;
    return (
      <FormSheet visible={visible} title={`Add the ${totalPages} page${totalPages === 1 ? '' : 's'}`} onClose={onClose} onSubmit={onClose} submitLabel="Close" error={error}>
        <Text style={styles.hint}>{read} of {totalPages} page{totalPages === 1 ? '' : 's'} read. Pages are read at the same time, so you can add the next while the others are being read. The review opens when all are done.</Text>
        {pages.map((n) => {
          const server = serverPages.find((p) => p.page_number === n);
          const state = slotState(locals[n]?.state, server);
          const busyPage = state === 'queued' || state === 'uploading' || state === 'processing';
          const problem = state === 'failed' ? (locals[n]?.error || server?.error_message || 'Please try again with a clearer photo.') : '';
          return (
            <View key={n} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>Page {n}</Text>
                <StatusPill label={SLOT_LABEL[state]} tone={state === 'failed' ? 'error' : state === 'extracted' ? 'success' : busyPage ? 'info' : 'neutral'} />
              </View>
              {problem ? <Text style={styles.problem}>{problem}</Text> : null}
              {!busyPage && state !== 'extracted' ? (
                <View style={styles.row}>
                  <View style={styles.col}><Button title={state === 'failed' ? 'Retry (photo)' : 'Take a photo'} size="sm" onPress={() => pick(n, true)} /></View>
                  <View style={styles.col}><Button title="Choose from photos" size="sm" variant="outline" onPress={() => pick(n, false)} /></View>
                </View>
              ) : null}
            </View>
          );
        })}
        <Button title="Start over" variant="ghost" size="sm" onPress={startOver} />
      </FormSheet>
    );
  }

  // ─── 3. review: questions, sections, details ───
  const missing = missingBeforeAccept(review);
  const total = Number(review.totalMarks) || 0;
  const captured = allocatedMarks(review.sections);
  const stepTitle = step === 1 ? 'Review the questions' : step === 2 ? 'Review the sections' : 'Paper details';
  const nextLabel = step === 1 ? 'Next: sections' : step === 2 ? 'Next: details' : `Add ${review.questions.length} question${review.questions.length === 1 ? '' : 's'} to the paper`;
  const onNext = () => (step === 3 ? accept() : (setError(null), setStep((step + 1) as Step)));

  return (
    <FormSheet visible={visible} title={`${step}. ${stepTitle}`} onClose={onClose} onSubmit={onNext} submitLabel={nextLabel} busy={busy} error={error}
      secondaryLabel={step > 1 ? 'Back' : undefined} onSecondary={step > 1 ? () => { setError(null); setStep((step - 1) as Step); } : undefined}>
      {step === 1 ? (
        <View style={styles.gap}>
          {review.warning ? <Text style={styles.warn}>{review.warning}</Text> : null}
          <Text style={styles.hint}>
            {review.questions.length} question{review.questions.length === 1 ? '' : 's'} read from {totalPages} page{totalPages === 1 ? '' : 's'}, in paper order.
            {needsCheck(review) > 0 ? ` ${needsCheck(review)} to check: the type was a guess.` : ' Check each type; the sections are built from them.'}
          </Text>
          {review.questions.map((q, i) => (
            <View key={q.localId} style={[styles.card, q.needsReview && styles.flagged]}>
              <Text style={styles.sub}>{i + 1}. {typeLabel(q.type)} · {Number(q.marks) || 1} mark{Number(q.marks) === 1 ? '' : 's'}{q.needsReview ? ' · check the type' : ''}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Question ${i + 1}`}>
                <Text style={[styles.text, !q.text.trim() && styles.empty]} numberOfLines={3}>{plainText(q.text).trim() || '(no text read: edit it in the next steps or remove it)'}</Text>
              </TouchableOpacity>
              {q.uncertain.length > 0 ? <Text style={styles.warn}>Check digits: {q.uncertain.join('; ')}</Text> : null}
              {(review.photos ?? []).length > 0 ? (
                <Button title="View photo" variant="outline" size="sm" onPress={() => { setViewer({ page: q.pageNumber ?? 1, box: q.box }); }} />
              ) : null}
              <Select label="Type" value={q.type} onChange={(v) => patch(changeQuestionType(review, q.localId, String(v)))} options={QUESTION_TYPES.map((t) => ({ value: t.value as string, label: t.label }))} />
            </View>
          ))}
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.gap}>
          <Text style={styles.hint}>Sections were built from the question types and the headings on the paper. A section that ran across a page break is already joined. Adjust titles, counts and marks if needed.</Text>
          <SectionsEditor
            sections={review.sections} onChange={(next) => patch({ sections: next })} noun="paper"
            placed={(k) => review.questions.filter((q) => q.sectionKey === k).length}
            onRemove={(k) => patch({ sections: review.sections.filter((x) => x.key !== k), questions: review.questions.map((q) => (q.sectionKey === k ? { ...q, sectionKey: '' } : q)) })}
          />
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.gap}>
          <Input label="Paper title *" value={review.title} onChangeText={(v) => patch({ title: v })} />
          <Input label="Total marks *" value={review.totalMarks} onChangeText={(v) => patch({ totalMarks: v })} keyboardType="decimal-pad" />
          <Input label="Duration (minutes)" value={review.duration} onChangeText={(v) => patch({ duration: v })} keyboardType="number-pad" />
          <Text style={styles.hint}>
            On the paper: class {review.classLabel || 'not found'}, subject {review.subjectLabel || 'not found'}.
            {classId && subjectId ? ' Your selection on the paper screen is used.' : ' Choose the class and subject on the paper screen before adding; nothing is saved until then.'}
          </Text>
          {total > 0 ? (
            <Text style={captured === total ? styles.hint : styles.warn}>
              {captured === total ? `${captured} of ${total} marks: the sections add up.` : `The sections add up to ${captured} marks but the total is ${total}. Check step 2, or correct the total.`}
            </Text>
          ) : null}
          {groups.length === 0 ? <Text style={styles.warn}>There are no sections; the questions will be added without one.</Text> : null}
          {missing.length > 0 ? <Text style={styles.problem}>Fill in before adding: {missing.join(', ')}.</Text> : null}
        </View>
      ) : null}

      <Button title="Start over" variant="ghost" size="sm" onPress={startOver} />
      <PaperPhotoViewer
        visible={!!viewer} photos={review.photos ?? []} page={viewer?.page ?? 1} box={viewer?.box ?? null}
        onPageChange={(page) => setViewer((v) => (v ? { page, box: null } : v))} onClose={() => setViewer(null)}
      />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { fontSize: FontSize.sm, color: Colors.warningText ?? Colors.textSecondary },
  problem: { fontSize: FontSize.sm, color: Colors.errorText },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  col: { flex: 1, minWidth: 120 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  card: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: Spacing.xs },
  flagged: { borderWidth: 1, borderColor: Colors.warningText ?? Colors.border },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  text: { fontSize: FontSize.md, color: Colors.text },
  empty: { color: Colors.errorText },
});
