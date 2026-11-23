import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import SearchBar from '../../ui/SearchBar';
import SegmentedTabs from '../../ui/SegmentedTabs';
import BottomSheet from '../../ui/BottomSheet';
import Skeleton from '../../ui/Skeleton';
import ErrorState from '../../ui/ErrorState';
import { useToast } from '../../ui/Toast';
import { confirm } from '../../ui/confirm';
import PaperPagesSheet from '../PaperPagesSheet';
import BlockForm from './BlockForm';
import PaperPreview from './PaperPreview';
import StructureEditor from './StructureEditor';
import TypePickerSheet from './TypePickerSheet';
import { examinationsApi } from '../../../services/api';
import { useBlockRegistry, usePaperDocument } from '../../../hooks/useBlockPaper';
import { useQuestionsPaged } from '../../../hooks/useQuestionBank';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import {
  bankAddedMessage, bankQuestionsToBlocks, blockSummary, documentMarks, duplicateBlock, isLostActivity, isQuestionBlock, mergeSavedIds, moveBlock, newBlockFor,
  isEarlyClass, problemsByQuestion, questionNumbers, scannedBlocksToBlocks, stillToFill, withItemKeys, type Block, type BlockDocument,
} from '../../../services/shared/blockDocument';
import {
  answerKeyErrorMessage, formatMarks, stillToFillFromError, generalProblems, headerSwitchOn, insertBlocks, kindNoun, nextSelection, problemsFromError, SAVE_DELAY_MS, SAVE_LABEL,
  type DocKind, type SaveState,
} from '../../../services/blockPaper';
import { emptyPagesSession, type PagesSession } from '../../../services/paperPages';
import { printPaper, shareAnswerKey, sharePaperPdf, sharePaperWord } from '../../../services/paperPrint';
import { exportErrorMessage } from '../../../services/reports';
import { plainText } from '../../../services/richText';
import { typeLabel, type Question } from '../../../services/questionBank';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

type Tab = 'outline' | 'paper';
const PREVIEW_DELAY_MS = 700;

interface Props {
  /** 'worksheet' since Phase 6b: same editor and server path, other endpoints, words and header defaults. */
  kind?: DocKind;
  paperId: number;
  title: string;
  readOnly: boolean;
  classId: number | null;
  subjectId: number | null;
  // The uploads behind blocks added from a photo, so the screen can record the scan feedback (confirm) as the web does.
  onCaptured?: (p: { uploadIds: number[]; blocks: Block[] }) => void;
  /** 'structure' (step 2: the paper's shape) or 'fill' (step 3: writing on the paper). One editor serves both. */
  mode?: 'structure' | 'fill';
  onModeChange?: (mode: 'structure' | 'fill') => void;
}

// The whole paper as blocks, on a phone. Paper: the server's page on top, where a tap chooses a question, and that
// question's form docked below it with Previous / Next / Next to fill, so the teacher writes "on the paper" and sees
// it fill (docs/PAPER_BUILDER_STRUCTURE_PLAN.md). Questions: the outline with move, copy and delete, the add buttons
// and the paper header. Autosaves the block list 1.2 s after the last change and once more on leaving.
export default function BlockPaperEditor({ kind = 'paper', paperId, title, readOnly, classId, subjectId, onCaptured, mode = 'fill', onModeChange }: Props) {
  const noun = kindNoun(kind);
  const isWorksheet = kind === 'worksheet';
  const toast = useToast();
  const { height } = useWindowDimensions();
  const registryQuery = useBlockRegistry();
  const registry = registryQuery.data ?? null;
  const documentQuery = usePaperDocument(paperId, kind);

  const [doc, setDoc] = useState<BlockDocument | null>(null);
  const [converted, setConverted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('paper');
  const [notPrinted, setNotPrinted] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [capture, setCapture] = useState<PagesSession>(emptyPagesSession());
  const [busy, setBusy] = useState<string | null>(null);
  const docRef = useRef<BlockDocument | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const loadedFor = useRef<number | null>(null);
  dirtyRef.current = dirty;

  // Load once per paper: a later refetch must not overwrite what the teacher is typing.
  useEffect(() => {
    const body = documentQuery.data;
    if (!body || loadedFor.current === paperId) return;
    loadedFor.current = paperId;
    const loaded = withItemKeys(body.document || { blocks: [] }) as BlockDocument;
    setDoc(loaded);
    docRef.current = loaded;
    setConverted(Boolean(body.converted));
    setSelectedId(loaded.blocks?.[0]?.id ?? null);
    setDirty(false);
    setSaveState('saved');
  }, [documentQuery.data, paperId]);

  const update = useCallback((updater: (prev: BlockDocument) => BlockDocument) => {
    if (readOnly) return;
    setDoc((prev) => {
      const next = updater(prev ?? { blocks: [] });
      docRef.current = next;
      return next;
    });
    setDirty(true);
    setSaveState((prev) => (prev === 'saving' ? prev : 'pending'));
  }, [readOnly]);

  const blocks = useMemo(() => doc?.blocks ?? [], [doc]);
  const numbers = useMemo(() => questionNumbers(blocks, registry), [blocks, registry]);
  const total = useMemo(() => documentMarks(doc, registry), [doc, registry]);
  const problemMap = useMemo(() => problemsByQuestion(problems), [problems]);
  const selectedIndex = blocks.findIndex((b) => b.id === selectedId);
  const selected = selectedIndex >= 0 ? blocks[selectedIndex] : null;
  const selectedProblems = selected && numbers[selectedIndex] ? problemMap.get(numbers[selectedIndex] as number) ?? [] : [];
  const direction: 'ltr' | 'rtl' = doc?.direction === 'rtl' ? 'rtl' : 'ltr';
  // The paper's class, from the server's header: Play Group, Nursery and Prep see activity types first.
  const className = String((documentQuery.data?.header as { class_name?: unknown } | undefined)?.class_name ?? '');

  // ---- autosave
  const save = useCallback(async () => {
    if (readOnly || savingRef.current || !docRef.current) return;
    savingRef.current = true;
    const sent = docRef.current;
    setSaveState('saving');
    try {
      const response = await (isWorksheet ? examinationsApi.saveWorksheetDocument(paperId, sent) : examinationsApi.savePaperDocument(paperId, sent));
      const saved = (response.data as { document?: BlockDocument })?.document ?? { blocks: [] };
      setDoc((current) => {
        const merged = mergeSavedIds(current ?? sent, saved);
        docRef.current = merged;
        return merged;
      });
      setProblems([]);
      setConverted(false);
      // Anything typed while the save was on its way is still unsaved.
      const stillDirty = docRef.current !== sent && JSON.stringify(docRef.current) !== JSON.stringify(sent);
      setDirty(stillDirty);
      setSaveState(stillDirty ? 'pending' : 'saved');
      if (stillDirty) setTimeout(() => saveRef.current?.(), SAVE_DELAY_MS);
    } catch (error) {
      const list = problemsFromError(error);
      if (list) setProblems(list);
      else toast.error(`The ${noun} could not be saved. Your changes are kept here and are sent again on your next change.`);
      setSaveState('error');
      setDirty(false);
    } finally {
      savingRef.current = false;
    }
  }, [isWorksheet, noun, paperId, readOnly, toast]);
  const saveRef = useRef(save);
  saveRef.current = save;

  const saveTrigger = useDebouncedValue(doc, SAVE_DELAY_MS);
  useEffect(() => {
    if (dirty && saveTrigger) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTrigger]);

  // Leaving the screen saves what is still unsaved (the request outlives the screen).
  useEffect(() => () => { if (dirtyRef.current) saveRef.current?.(); }, []);

  // ---- preview of the unsaved paper, made only while the Paper tab is open; it opens at the question being written
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const previewTrigger = useDebouncedValue(doc, PREVIEW_DELAY_MS);
  useEffect(() => {
    if (tab !== 'paper' || mode !== 'fill' || !previewTrigger) return undefined;
    let cancelled = false;
    const show = selectedRef.current;
    (isWorksheet ? examinationsApi.previewWorksheetDocument(paperId, previewTrigger, show) : examinationsApi.previewPaperDocument(paperId, previewTrigger, show))
      .then((res) => { if (!cancelled) { setPreviewHtml(String(res.data)); setPreviewError(null); } })
      .catch((error) => {
        if (cancelled) return;
        const list = problemsFromError(error);
        setPreviewError(list ? 'Fix the problems listed to see the preview.' : 'The preview could not be made.');
        if (list) setProblems(list);
      });
    return () => { cancelled = true; };
  }, [isWorksheet, mode, paperId, previewTrigger, tab]);

  // ---- block actions
  const add = (added: Block[]) => {
    if (!added.length) return;
    update((prev) => ({ ...prev, blocks: insertBlocks(prev.blocks ?? [], selectedIndex, added) }));
    setSelectedId(added[0].id);
  };
  const replace = (next: Block) => update((prev) => ({ ...prev, blocks: prev.blocks.map((b) => (b.id === next.id ? next : b)) }));
  const move = (index: number, delta: number) => update((prev) => ({ ...prev, blocks: moveBlock(prev.blocks, index, delta) }));
  const copy = (index: number) => {
    const clone = duplicateBlock(blocks[index]);
    update((prev) => {
      const list = [...prev.blocks];
      list.splice(index + 1, 0, clone);
      return { ...prev, blocks: list };
    });
    setSelectedId(clone.id);
  };
  const remove = async (index: number) => {
    const gone = blocks[index];
    if (!(await confirm({ title: 'Delete this question?', message: gone.title || `This block is removed from the ${noun}.`, confirmLabel: 'Delete', destructive: true }))) return;
    update((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== gone.id) }));
    if (gone.id === selectedId) setSelectedId(nextSelection(blocks, index));
  };
  const setHeader = (name: string, value: unknown) => update((prev) => ({ ...prev, header: { ...(prev.header ?? {}), [name]: value } }));

  // Printing and Word read the saved paper, so save first.
  const withSaved = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      for (let waited = 0; savingRef.current && waited < 15000; waited += 150) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!readOnly && (dirtyRef.current || saveState !== 'saved')) await save();
      await action();
      setNotPrinted([]);
    } catch (e) {
      // A draft prints only once nothing is left to fill; the list says what is left.
      const left = stillToFillFromError(e);
      if (left) { setNotPrinted(left); return; }
      toast.error((label === 'Key' ? answerKeyErrorMessage(e) : null) ?? ((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message || `Could not ${label.toLowerCase()} the ${noun}.`));
    } finally {
      setBusy(null);
    }
  };

  if (documentQuery.isError && !doc) return <ErrorState error={documentQuery.error} onRetry={() => documentQuery.refetch()} />;
  if (registryQuery.isError && !registry) return <ErrorState error={registryQuery.error} onRetry={() => registryQuery.refetch()} />;
  if (!doc || !registry) return <Skeleton />;

  if (mode === 'structure') {
    return (
      <StructureEditor blocks={blocks} registry={registry} kind={kind} paperId={paperId} classId={classId} subjectId={subjectId} className={className} readOnly={readOnly}
        onSkip={() => onModeChange?.('fill')}
        onApply={(next) => {
          update((prev) => ({ ...prev, blocks: next }));
          setSelectedId((next.find((b) => stillToFill(b, registry)) ?? next[0])?.id ?? null);
          setTab('paper');
          onModeChange?.('fill');
        }} />
    );
  }

  const header = (doc.header ?? {}) as Record<string, any>;
  const general = generalProblems(problems);
  const toFill = blocks.filter((block) => stillToFill(block, registry));
  const nextToFill = () => {
    const target = blocks.slice(selectedIndex + 1).find((block) => stillToFill(block, registry)) ?? toFill[0];
    if (target) setSelectedId(target.id);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {!isWorksheet || total > 0 ? <Text style={styles.total}>Total marks: {formatMarks(total)}</Text> : <Text style={styles.total}>No marks</Text>}
        <Text style={[styles.sub, saveState === 'error' && styles.errorText]} accessibilityRole="text" accessibilityLiveRegion="polite">
          {readOnly ? 'Read only' : SAVE_LABEL[saveState]}
        </Text>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Share PDF" size="sm" loading={busy === 'Share'} disabled={!!busy} onPress={() => withSaved('Share', () => sharePaperPdf(paperId, title, kind))} /></View>
        <View style={styles.flex}><Button title="Print" size="sm" variant="outline" loading={busy === 'Print'} disabled={!!busy} onPress={() => withSaved('Print', () => printPaper(paperId, kind))} /></View>
        <View style={styles.flex}><Button title="Word" size="sm" variant="outline" loading={busy === 'Download'} disabled={!!busy} onPress={() => withSaved('Download', () => sharePaperWord(paperId, title, kind))} /></View>
      </View>
      <Button title="Answer key (PDF)" size="sm" variant="outline" loading={busy === 'Key'} disabled={!!busy}
        onPress={() => withSaved('Key', () => shareAnswerKey(paperId, title, kind))} />
      {converted ? <Text style={styles.info}>This {noun} was made with the old builder and is shown here as blocks. It is saved in the new form when you change something.</Text> : null}
      {notPrinted.length > 0 ? (
        <View style={styles.notPrinted} accessibilityRole="alert">
          <Text style={styles.label}>Not printed yet: fill these first.</Text>
          {notPrinted.slice(0, 8).map((line) => <Text key={line} style={styles.sub}>• {line}</Text>)}
          {notPrinted.length > 8 ? <Text style={styles.sub}>and {notPrinted.length - 8} more</Text> : null}
          <Button title="Close" size="sm" variant="ghost" onPress={() => setNotPrinted([])} />
        </View>
      ) : null}
      {general.length > 0 ? (
        <View style={styles.problems} accessibilityRole="alert">{general.map((p) => <Text key={p} style={styles.errorText}>• {p}</Text>)}</View>
      ) : null}

      <SegmentedTabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'paper', label: 'Paper' },
        { value: 'outline', label: `Questions (${numbers.filter(Boolean).length})` },
      ]} />

      {tab === 'outline' ? (
        <View style={styles.gap}>
          {blocks.length === 0 ? <Text style={styles.sub}>No questions yet. Plan the structure, add one, take them from the question bank, or read them from a photo of a {noun}.</Text> : null}
          {blocks.map((block, index) => {
            const number = numbers[index];
            const flagged = !!number && problemMap.has(number);
            const on = block.id === selectedId;
            const todo = stillToFill(block, registry);
            return (
              <View key={block.id} style={[styles.card, on && styles.cardOn]}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${number ? `Question ${number}` : 'Heading'}: ${block.title || 'no heading'}. Open to edit.`}
                  style={styles.cardBody} onPress={() => { setSelectedId(block.id); setTab('paper'); }}>
                  <Text style={[styles.num, flagged && styles.errorText, !flagged && todo && styles.todoText]}>{number ? `Q${number}` : '§'}{flagged || todo ? ' ●' : ''}</Text>
                  <View style={styles.flex}>
                    <Text style={[styles.title, todo && styles.sub]} numberOfLines={2}>{block.title || '(no heading)'}{todo ? '  (still to fill)' : ''}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{blockSummary(block, registry)}{isQuestionBlock(block, registry) && (!isWorksheet || block.marks != null) ? ` · ${block.marks ?? 0} marks` : ''}</Text>
                  </View>
                </TouchableOpacity>
                {!readOnly ? (
                  <View style={styles.actions}>
                    <IconButton label="↑" hint={`Move ${number ? `question ${number}` : 'heading'} up`} disabled={index === 0} onPress={() => move(index, -1)} />
                    <IconButton label="↓" hint={`Move ${number ? `question ${number}` : 'heading'} down`} disabled={index === blocks.length - 1} onPress={() => move(index, 1)} />
                    <IconButton label="Copy" hint={`Copy ${number ? `question ${number}` : 'heading'}`} onPress={() => copy(index)} />
                    <IconButton label="Delete" hint={`Delete ${number ? `question ${number}` : 'heading'}`} danger onPress={() => remove(index)} />
                  </View>
                ) : null}
              </View>
            );
          })}
          {!readOnly ? (
            <>
              {onModeChange ? <Button title={blocks.length ? 'Change the structure' : 'Plan the structure first'} variant={blocks.length ? 'outline' : 'primary'} onPress={() => onModeChange('structure')} /> : null}
              <Button title="+ Add question" onPress={() => setAddOpen(true)} />
              <Button title="From question bank" variant="outline" onPress={() => setBankOpen(true)} disabled={!subjectId} />
              <Button title={capture.totalPages ? `From a photo (${capture.totalPages} page${capture.totalPages === 1 ? '' : 's'} in progress)` : `From a photo of a ${noun}`} variant="outline" onPress={() => setPhotoOpen(true)} />
            </>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{isWorksheet ? 'Worksheet header' : 'Paper header'}</Text>
            {isWorksheet ? (
              <Select label="Header style" value={header.header_style === 'compact' ? 'compact' : 'standard'} disabled={readOnly}
                onChange={(v) => setHeader('header_style', v)}
                options={[{ value: 'compact', label: 'Compact: logo and one box' }, { value: 'standard', label: 'Standard: school name and title' }]} />
            ) : null}
            <Select label={isWorksheet ? 'Language' : 'Paper language'} value={direction} disabled={readOnly} onChange={(v) => update((prev) => ({ ...prev, direction: v }))}
              options={[{ value: 'ltr', label: 'English (left to right)' }, { value: 'rtl', label: 'اردو Urdu (right to left)' }]} />
            {!isWorksheet ? (
              <View style={styles.row}>
                <Text style={[styles.flex, styles.label]}>“For office use” marks table</Text>
                <Switch value={headerSwitchOn(header, 'marks_table', kind)} disabled={readOnly} onValueChange={(v) => setHeader('marks_table', v)} accessibilityLabel="For office use marks table" />
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={[styles.flex, styles.label]}>School logo</Text>
              <Switch value={header.show_logo !== false} disabled={readOnly} onValueChange={(v) => setHeader('show_logo', v)} accessibilityLabel="School logo" />
            </View>
            <View style={styles.row}>
              <Text style={[styles.flex, styles.label]}>{isWorksheet ? 'Total marks line' : 'Time and total marks line'}</Text>
              <Switch value={headerSwitchOn(header, 'show_time_marks', kind)} disabled={readOnly} onValueChange={(v) => setHeader('show_time_marks', v)}
                accessibilityLabel={isWorksheet ? 'Total marks line' : 'Time and total marks line'} />
            </View>
            {!isWorksheet ? (
              <Input label="Signature label" value={header.sign_label ?? 'Teacher’s Sign'} editable={!readOnly} onChangeText={(v) => setHeader('sign_label', v)} />
            ) : null}
          </View>
        </View>
      ) : null}

      {tab === 'paper' ? (
        <View style={styles.gap}>
          {blocks.length === 0 ? (
            <View style={styles.gap}>
              <Text style={styles.sub}>No questions yet.</Text>
              {onModeChange && !readOnly ? <Button title="Plan the structure first" onPress={() => onModeChange('structure')} /> : null}
              {!readOnly ? <Button title="+ Add question" variant="outline" onPress={() => setAddOpen(true)} /> : null}
            </View>
          ) : null}
          {previewError ? <Text style={styles.errorText}>{previewError}</Text> : null}
          {blocks.length > 0 ? (
            <PaperPreview html={previewHtml} height={Math.max(300, Math.round(height * 0.45))} show={selectedId} onPick={setSelectedId} />
          ) : null}
          {selected ? (
            // The docked editor: the question being written, its form, and the way to the next one.
            <View style={styles.dock}>
              <View style={styles.row}>
                <View style={styles.flex}><Button title="‹ Previous" size="sm" variant="ghost" disabled={selectedIndex <= 0} onPress={() => setSelectedId(blocks[selectedIndex - 1]?.id ?? null)} /></View>
                <Text style={styles.sub}>{numbers[selectedIndex] ? `Q${numbers[selectedIndex]}` : 'Heading'} · {selectedIndex + 1} of {blocks.length}</Text>
                <View style={styles.flex}><Button title="Next ›" size="sm" variant="ghost" disabled={selectedIndex >= blocks.length - 1} onPress={() => setSelectedId(blocks[selectedIndex + 1]?.id ?? null)} /></View>
              </View>
              {toFill.length > 0 && !readOnly ? (
                <Button title={`Next to fill (${toFill.length} left)`} size="sm" variant="outline" onPress={nextToFill} />
              ) : null}
              <BlockForm key={selected.id} block={selected} registry={registry} onChange={replace} readOnly={readOnly} problems={selectedProblems} direction={direction} optionalMarks={isWorksheet} />
            </View>
          ) : null}
        </View>
      ) : null}

      <TypePickerSheet visible={addOpen} onClose={() => setAddOpen(false)} registry={registry} early={isEarlyClass(className)}
        used={blocks.map((block) => block.type)}
        onPick={(type) => { add([newBlockFor(kind, type, registry, blocks)]); setTab('paper'); }} />

      <BankPicker visible={bankOpen} subject={subjectId} noun={noun} onClose={() => setBankOpen(false)}
        onAdd={(questions) => {
          const picked = questions as unknown as Array<Record<string, any>>;
          add(bankQuestionsToBlocks(picked));
          setBankOpen(false);
          // An old activity saved without its drawing is left out; the message says so instead of a plain success.
          toast.show(bankAddedMessage(picked), picked.some(isLostActivity) ? 'info' : 'success');
        }} />

      <PaperPagesSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} classId={classId} subjectId={subjectId}
        session={capture} setSession={setCapture} registry={registry}
        onAcceptBlocks={({ blocks: read, direction: scanned, uploadIds }) => {
          const added = scannedBlocksToBlocks(read);
          // An empty paper (or worksheet) takes the photo's direction, so a scanned Urdu paper prints right to left.
          if (scanned && blocks.length === 0) update((prev) => ({ ...prev, direction: scanned }));
          add(added);
          onCaptured?.({ uploadIds, blocks: read });
          toast.success(`${added.length} block${added.length === 1 ? '' : 's'} added from the photo. Check them before printing.`);
        }} />
    </View>
  );
}

function IconButton({ label, hint, onPress, disabled, danger }: { label: string; hint: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={hint} disabled={disabled} onPress={onPress} style={styles.iconBtn}>
      <Text style={[styles.iconText, danger && styles.errorText, disabled && styles.off]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Questions of the paper's subject from the bank, several at once (the web's picker also filters by class topics).
function BankPicker({ visible, subject, noun, onClose, onAdd }: { visible: boolean; subject: number | null; noun: string; onClose: () => void; onAdd: (q: Question[]) => void }) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useQuestionsPaged(term, subject, '', '');
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const [chosen, setChosen] = useState<Question[]>([]);
  useEffect(() => { if (!visible) setChosen([]); }, [visible]);
  const ids = new Set(chosen.map((q) => q.id));
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add from the question bank">
      <View style={styles.sheetBody}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search questions..." />
        <FlatList data={rows} keyExtractor={(q) => String(q.id)} style={styles.list} keyboardShouldPersistTaps="handled"
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          ListEmptyComponent={<Text style={styles.sub}>{query.isLoading ? 'Loading…' : 'No questions found for this subject.'}</Text>}
          renderItem={({ item: q }) => {
            const on = ids.has(q.id);
            return (
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.pick, on && styles.cardOn]}
                onPress={() => setChosen((c) => (on ? c.filter((x) => x.id !== q.id) : [...c, q]))}>
                <Text style={styles.title} numberOfLines={2}>{on ? '✓ ' : ''}{plainText(q.question_text)}</Text>
                <Text style={styles.sub}>{typeLabel(q.question_type)} · {Number(q.marks)} marks</Text>
              </TouchableOpacity>
            );
          }} />
        <Button title={`Add ${chosen.length} to the ${noun}`} disabled={chosen.length === 0} onPress={() => onAdd(chosen)} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  gap: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs },
  total: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  title: { fontSize: FontSize.md, color: Colors.text },
  info: { fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.infoLight, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  notPrinted: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 2 },
  todoText: { color: Colors.warning },
  dock: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.primary, padding: Spacing.sm, gap: Spacing.sm },
  problems: { backgroundColor: Colors.errorLight, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 2 },
  errorText: { color: Colors.errorText },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  cardOn: { borderColor: Colors.primary, borderWidth: 2 },
  cardBody: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.sm, minHeight: 44 },
  num: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, minWidth: 34 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: Colors.border },
  iconBtn: { minWidth: 48, minHeight: 44, paddingHorizontal: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: FontSize.md, color: Colors.primary },
  off: { opacity: 0.3 },
  panel: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs, marginTop: Spacing.sm },
  panelTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sheetBody: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  list: { maxHeight: 380 },
  pick: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs, minHeight: 44 },
});
