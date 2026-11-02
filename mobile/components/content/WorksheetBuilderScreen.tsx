import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { useQuestionActions, useQuestionsPaged } from '../../hooks/useQuestionBank';
import { useWorksheet, useWorksheetActions } from '../../hooks/useWorksheets';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { hydrateStructure, serializeStructure, type Section } from '../../services/paperBuilder';
import { pictureProblem, QUESTION_TYPES, typeLabel, type Question } from '../../services/questionBank';
import {
  assignItemSection, buildAutosavePayload, countInSection, draftFromWorksheet, draftKey, emptyItem, excludedQuestionIds, isDraft, itemFromQuestion,
  itemFromRow, moveItem, newLocalId, removeItem, saveLabel, unassignSection, validateItem, WORKSHEET_TYPES, worksheetFileName,
  type SaveState, type WorksheetDraft, type WorksheetItem,
} from '../../services/worksheets';
import { inventoryErrorMessage } from '../../services/inventory';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SearchBar from '../ui/SearchBar';
import SegmentedTabs from '../ui/SegmentedTabs';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import BottomSheet from '../ui/BottomSheet';
import { useToast } from '../ui/Toast';
import SectionsEditor from './SectionsEditor';
import PaperCaptureSheet from './PaperCaptureSheet';
import { emptyCapture, worksheetItems, type CaptureState } from '../../services/paperCapture';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'items' | 'compose' | 'bank' | 'scan';
const AUTOSAVE_MS = 800;

// Build a worksheet: title and instructions, sections, and items written by hand or taken from the question bank.
// Port of the web Worksheet builder. A draft saves by itself a moment after you stop; a worksheet that is not a draft
// can be read and downloaded but not changed. Scanning a printed sheet comes with picture extraction.
export default function WorksheetBuilderScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const wid = Number(id) || null;
  const toast = useToast();
  const query = useWorksheet(wid);
  const actions = useWorksheetActions();
  const questions = useQuestionActions();
  const worksheet = query.data;
  const [draft, setDraft] = useState<WorksheetDraft | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<WorksheetItem[]>([]);
  const [tab, setTab] = useState<Tab>('items');
  const [save, setSave] = useState<SaveState>('idle');
  const [current, setCurrent] = useState<WorksheetItem>(emptyItem());
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  // Scan a printed worksheet: the capture lives here so closing the sheet keeps it until it is accepted or started over.
  const [capture, setCapture] = useState<CaptureState>(emptyCapture());
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const hydrated = useRef(false);
  const lastSent = useRef('');

  // Hydrate once when the worksheet first loads; after that the screen's own state is the source of truth and autosave pushes it up.
  useEffect(() => {
    if (!worksheet || hydrated.current) return;
    hydrated.current = true;
    const d = draftFromWorksheet(worksheet);
    const secs = hydrateStructure(worksheet.structure);
    const rows = (worksheet.items ?? []).slice().sort((a, b) => a.item_order - b.item_order).map(itemFromRow);
    setDraft(d); setSections(secs); setItems(rows);
    lastSent.current = draftKey({ ...d, structure: serializeStructure(secs) as never }, rows);
  }, [worksheet]);

  const editable = !!worksheet && isDraft(worksheet);
  const fullDraft: WorksheetDraft | null = useMemo(() => (draft ? { ...draft, structure: serializeStructure(sections) as never } : null), [draft, sections]);
  const key = fullDraft ? draftKey(fullDraft, items) : '';
  const debouncedKey = useDebouncedValue(key, AUTOSAVE_MS);

  // Autosave: the whole draft goes up when it differs from what was last sent.
  const latest = useRef({ fullDraft, items, key });
  latest.current = { fullDraft, items, key };
  useEffect(() => {
    if (!wid || !editable || !fullDraft || !debouncedKey || debouncedKey === lastSent.current) return;
    const sentKey = debouncedKey;
    setSave('saving');
    actions.autosave.mutateAsync({ id: wid, data: buildAutosavePayload(fullDraft, items) })
      .then(() => { lastSent.current = sentKey; setSave('saved'); })
      .catch((e) => { setSave('error'); toast.error(inventoryErrorMessage(e, 'Failed to save.')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, wid, editable]);

  // Leaving the screen mid-pause must not lose the last edit.
  useEffect(() => () => {
    const l = latest.current;
    if (wid && editable && l.fullDraft && l.key !== lastSent.current) examinationsApi.autosaveWorksheetDraft(wid, buildAutosavePayload(l.fullDraft, l.items)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, editable]);

  const groups = sections.filter((s) => s.type !== 'divider');
  const set = (patch: Partial<WorksheetDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setCur = (patch: Partial<WorksheetItem>) => setCurrent((c) => ({ ...c, ...patch }));

  const addItem = () => {
    const problem = validateItem(current);
    if (problem) return setError(problem);
    setError(null);
    setItems((its) => [...its, { ...current, localId: current.localId || newLocalId() }]);
    setCurrent(emptyItem(current.sectionKey));
    setTab('items');
    toast.success('Added to the worksheet.');
  };

  // A picture needs a bank question to hang on: the question is created first (as the web does), then the picture uploaded.
  const addPicture = async () => {
    if (!worksheet?.subject) return toast.error('This worksheet has no subject. Add the question without a picture.');
    if (!current.text.trim()) return toast.error('Write the question first.');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error('Allow photo access in your phone settings.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = pictureProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return toast.error(problem);
    setPictureBusy(true);
    try {
      let qid = current.question;
      if (!qid) {
        const res = await questions.create.mutateAsync({
          subject: worksheet.subject, question_text: current.text, question_type: current.type, marks: Number(current.marks) || 1,
          correct_answer: current.correct || '', answer_text: current.answerText || '', type_data: current.typeData || {},
          ...(current.type === 'MCQ' ? { option_a: current.options.A, option_b: current.options.B, option_c: current.options.C, option_d: current.options.D } : {}),
        });
        qid = (res.data as { id: number }).id;
        setCur({ question: qid });
      }
      const form = new FormData();
      form.append('slot', 'question');
      form.append('file', { uri: asset.uri, name: asset.fileName ?? 'diagram.jpg', type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob);
      const up = (await questions.uploadPicture.mutateAsync({ id: qid as number, form })).data as { question_image_url?: string };
      setCur({ question: qid, imageUrl: up.question_image_url ?? null });
      toast.success('Picture added.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not add the picture.'));
    } finally {
      setPictureBusy(false);
    }
  };

  const dropPicture = async () => {
    if (!current.question) return;
    try {
      await questions.removePicture.mutateAsync({ id: current.question, slot: 'question' });
      setCur({ imageUrl: null });
    } catch {
      toast.error('Could not remove the picture.');
    }
  };

  const download = async (kind: 'pdf' | 'docx') => {
    if (!wid || !draft) return;
    setBusy(kind);
    try {
      await shareReportFile(() => (kind === 'pdf' ? examinationsApi.generateWorksheetPdf(wid) : examinationsApi.generateWorksheetDocx(wid)), worksheetFileName(draft.title, kind), kind);
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (query.isLoading || (query.data && !draft)) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!worksheet || !draft) return <EmptyState title="Worksheet not found" message="Open it from the Worksheets list." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Input label="Title" value={draft.title} onChangeText={(v) => set({ title: v })} editable={editable} />
      <Text style={styles.sub}>{[worksheet.class_name, worksheet.subject_name].filter(Boolean).join('  ·  ')}  ·  {saveLabel(save, worksheet.status)}</Text>
      {!editable ? <Text style={styles.warn}>This worksheet is {worksheet.status.toLowerCase()}. Only a draft can be changed.</Text> : null}
      <View style={styles.row}>
        <Button title="PDF" size="sm" variant="outline" onPress={() => download('pdf')} loading={busy === 'pdf'} disabled={busy !== null} />
        <Button title="Word" size="sm" variant="outline" onPress={() => download('docx')} loading={busy === 'docx'} disabled={busy !== null} />
      </View>
      <Input label="Instructions" value={draft.instructions} onChangeText={(v) => set({ instructions: v })} multiline editable={editable} placeholder="General instructions for students..." />

      {editable ? (
        <SectionsEditor
          sections={sections} onChange={setSections} noun="worksheet"
          placed={(k) => countInSection(items, k)}
          onRemove={(k) => { setSections((ss) => ss.filter((s) => s.key !== k)); setItems((its) => unassignSection(its, k)); }}
        />
      ) : null}

      <SegmentedTabs
        tabs={[{ value: 'items', label: `Items (${items.length})` }, ...(editable ? [{ value: 'compose', label: 'Add manually' }, { value: 'bank', label: 'From bank' }, { value: 'scan', label: 'Scan' }] : [])] as Array<{ value: Tab; label: string }>}
        value={tab} onChange={setTab}
      />

      {tab === 'items' ? (
        items.length === 0 ? <EmptyState title="No items yet" message="Add some manually or from the question bank." /> : items.map((it, i) => (
          <View key={it.localId} style={styles.card}>
            <Text style={styles.sub}>{i + 1}. {typeLabel(it.type)}{it.sectionKey ? `  ·  ${groups.find((g) => g.key === it.sectionKey)?.title || 'Section'}` : ''}{it.imageUrl ? '  ·  picture' : ''}</Text>
            <Text style={styles.text}>{it.text}</Text>
            {editable && groups.length > 0 ? (
              <Select value={it.sectionKey} placeholder="Section" onChange={(v) => setItems((its) => assignItemSection(its, it.localId, v))}
                options={[{ value: '', label: 'Unassigned' }, ...groups.map((g) => ({ value: g.key, label: g.title || 'Section' }))]} />
            ) : null}
            {editable ? (
              <View style={styles.row}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move up" style={styles.btn} onPress={() => setItems((its) => moveItem(its, i, -1))}><Text style={styles.btnText}>↑</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move down" style={styles.btn} onPress={() => setItems((its) => moveItem(its, i, 1))}><Text style={styles.btnText}>↓</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove item" style={styles.btn} onPress={() => setItems((its) => removeItem(its, it.localId))}><Text style={[styles.btnText, { color: Colors.error }]}>✕</Text></TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))
      ) : null}

      {tab === 'compose' && editable ? (
        <View style={styles.card}>
          <Select label="Question type" value={current.type} onChange={(v) => setCur({ type: String(v) })}
            options={QUESTION_TYPES.filter((t) => (WORKSHEET_TYPES as readonly string[]).includes(t.value)).map((t) => ({ value: t.value as string, label: t.label }))} />
          {groups.length > 0 ? (
            <Select label="Section" value={current.sectionKey} onChange={(v) => setCur({ sectionKey: String(v) })}
              options={[{ value: '', label: 'Unassigned' }, ...groups.map((g) => ({ value: g.key, label: g.title || 'Section' }))]} />
          ) : null}
          <Input label="Question" value={current.text} onChangeText={(v) => setCur({ text: v })} multiline style={styles.big} placeholder="Type the question..." />
          {current.type === 'MCQ' ? (
            <>
              {(['A', 'B', 'C', 'D'] as const).map((l) => <Input key={l} label={`Option ${l}${l === 'A' || l === 'B' ? '' : ' (optional)'}`} value={current.options[l]} onChangeText={(v) => setCur({ options: { ...current.options, [l]: v } })} />)}
              <Select label="Correct option (optional)" value={current.correct} onChange={(v) => setCur({ correct: String(v) })} placeholder="Not set" options={['A', 'B', 'C', 'D'].map((k) => ({ value: k, label: k }))} />
            </>
          ) : current.type === 'TRUE_FALSE' ? (
            <Select label="Answer (optional)" value={current.correct.toLowerCase()} onChange={(v) => setCur({ correct: String(v) })} placeholder="Not set" options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} />
          ) : (
            <Input label="Answer key (optional)" value={current.correct} onChangeText={(v) => setCur({ correct: v })} />
          )}
          <Input label="Marks (optional, worksheets are usually ungraded)" value={current.marks} onChangeText={(v) => setCur({ marks: v })} keyboardType="decimal-pad" />
          <View style={styles.row}>
            <Button title={current.imageUrl ? 'Replace picture' : 'Add picture'} size="sm" variant="outline" onPress={addPicture} loading={pictureBusy} disabled={pictureBusy} />
            {current.imageUrl ? <Button title="Remove picture" size="sm" variant="ghost" onPress={dropPicture} /> : null}
          </View>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button title="+ Add to worksheet" onPress={addItem} />
        </View>
      ) : null}

      {tab === 'bank' && editable ? (
        <View style={styles.card}>
          {worksheet.subject ? (
            <Button title="Browse the question bank" onPress={() => setPicker(true)} />
          ) : <Text style={styles.sub}>This worksheet has no subject, so the question bank cannot be narrowed. Add questions manually instead.</Text>}
        </View>
      ) : null}

      {tab === 'scan' && editable ? (
        <View style={styles.card}>
          <Text style={styles.sub}>Photograph a printed worksheet and the questions are read from it, so you can check and add them instead of retyping the sheet.</Text>
          <Button title={capture.pages.length ? `Scan (${capture.pages.length} page${capture.pages.length === 1 ? '' : 's'} in progress)` : 'Scan a printed worksheet'} onPress={() => setScanOpen(true)} />
        </View>
      ) : null}

      <PaperCaptureSheet
        kind="worksheet" visible={scanOpen} onClose={() => setScanOpen(false)} classId={worksheet.class_obj} subjectId={worksheet.subject ?? null}
        capture={capture} setCapture={setCapture}
        onAccept={async (c) => {
          setSections((ss) => [...ss, ...c.sections]);
          setItems((its) => [...its, ...worksheetItems(c.questions, newLocalId)]);
          setCapture(emptyCapture());
          setTab('items');
        }}
      />

      <BankPicker
        visible={picker} subject={worksheet.subject ?? null} excluded={excludedQuestionIds(items)} onClose={() => setPicker(false)}
        onAttach={(qs) => { setItems((its) => [...its, ...qs.map(itemFromQuestion)]); setPicker(false); setTab('items'); }}
      />
    </ScrollView>
  );
}

// Choose several bank questions and attach them together; questions already on the sheet are left out.
function BankPicker({ visible, subject, excluded, onClose, onAttach }: {
  visible: boolean; subject: number | null; excluded: number[]; onClose: () => void; onAttach: (q: Question[]) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useQuestionsPaged(term, subject, '', '');
  const [chosen, setChosen] = useState<Question[]>([]);
  useEffect(() => { if (visible) setChosen([]); }, [visible]);
  const rows = useMemo(() => (query.data?.pages.flatMap((p) => p.results) ?? []).filter((q) => !excluded.includes(q.id)), [query.data, excluded]);
  const ids = new Set(chosen.map((c) => c.id));
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add from the question bank">
      <View style={styles.pickerBody}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search questions..." />
        <FlatList
          data={rows} keyExtractor={(q) => String(q.id)} style={styles.pickerList} keyboardShouldPersistTaps="handled"
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          ListEmptyComponent={<Text style={styles.sub}>{query.isLoading ? 'Loading…' : 'No questions found.'}</Text>}
          renderItem={({ item: q }) => {
            const on = ids.has(q.id);
            return (
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pick, on && styles.picked]} onPress={() => setChosen((cs) => (on ? cs.filter((c) => c.id !== q.id) : [...cs, q]))}>
                <Text style={styles.text} numberOfLines={2}>{on ? '✓ ' : ''}{q.question_text}</Text>
                <Text style={styles.sub}>{typeLabel(q.question_type)}</Text>
              </TouchableOpacity>
            );
          }}
        />
        <Button title={`Add ${chosen.length} to the worksheet`} onPress={() => onAttach(chosen)} disabled={chosen.length === 0} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { fontSize: FontSize.sm, color: Colors.warningText },
  error: { fontSize: FontSize.sm, color: Colors.error },
  text: { fontSize: FontSize.md, color: Colors.text },
  big: { minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs },
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: FontSize.lg, color: Colors.primary },
  pickerBody: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  pickerList: { maxHeight: 380 },
  pick: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs, minHeight: 44 },
  picked: { borderWidth: 2, borderColor: Colors.primary },
});
