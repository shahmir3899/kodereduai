import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { useWorksheet, useWorksheetActions } from '../../hooks/useWorksheets';
import { useSubjectsList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { detailsFromWorksheet, detailsPayload, isDraft, WORKSHEET_STATUSES, type WorksheetDetails } from '../../services/worksheets';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import BlockPaperEditor from './blocks/BlockPaperEditor';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const AUTOSAVE_MS = 800;

// Build a worksheet with the paper's block editor (Paper Builder v2 Phase 6b, user decision 2026-11-15): Details
// (title, instructions, and the subject when an old worksheet has none), then Build, the same editor as papers
// (blocks/BlockPaperEditor.tsx kind="worksheet"). An old worksheet opens converted to blocks and is saved in the new
// form only once something in it changes. A worksheet that is not a draft opens read only.
export default function WorksheetBuilderScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const wid = Number(id) || null;
  const toast = useToast();
  const query = useWorksheet(wid);
  const actions = useWorksheetActions();
  const subjects = useSubjectsList();
  const worksheet = query.data;
  const [details, setDetails] = useState<WorksheetDetails | null>(null);
  const [save, setSave] = useState<'saved' | 'saving' | 'error'>('saved');
  const [step, setStep] = useState<1 | 2>(2);
  const lastSent = useRef('');

  // Load once; after that what is typed here is the source of truth.
  useEffect(() => {
    if (!worksheet || details) return;
    const loaded = detailsFromWorksheet(worksheet);
    lastSent.current = JSON.stringify(detailsPayload(loaded));
    setDetails(loaded);
    // An old worksheet with no subject cannot keep questions in the bank: start on Details to choose one.
    if (!worksheet.subject && isDraft(worksheet)) setStep(1);
  }, [worksheet, details]);

  const editable = !!worksheet && isDraft(worksheet);
  const payloadKey = details ? JSON.stringify(detailsPayload(details)) : '';
  const debouncedKey = useDebouncedValue(payloadKey, AUTOSAVE_MS);

  // The editor saves the blocks; this saves only the details.
  useEffect(() => {
    if (!wid || !editable || !debouncedKey || debouncedKey === lastSent.current) return;
    const sent = debouncedKey;
    setSave('saving');
    actions.autosave.mutateAsync({ id: wid, data: JSON.parse(sent) })
      .then(() => {
        const subjectNow = (JSON.parse(sent) as { subject?: number }).subject ?? null;
        lastSent.current = sent;
        setSave('saved');
        // The editor and the bank picker read the subject from the worksheet.
        if (subjectNow && subjectNow !== worksheet?.subject) query.refetch();
      })
      .catch((e) => { setSave('error'); toast.error(inventoryErrorMessage(e, 'The worksheet details could not be saved.')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, wid, editable]);

  // Leaving the screen mid-pause must not lose the last edit.
  const latest = useRef(payloadKey);
  latest.current = payloadKey;
  useEffect(() => () => {
    if (wid && editable && latest.current && latest.current !== lastSent.current) {
      examinationsApi.autosaveWorksheetDraft(wid, JSON.parse(latest.current)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, editable]);

  if (query.isLoading || (query.data && !details)) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!worksheet || !details || !wid) return <EmptyState title="Worksheet not found" message="Open it from the Worksheets list." />;

  // Same as the web: Ready / Published lock the worksheet, "Edit again" makes it a draft; the server says why Ready is refused.
  const changeStatus = async (next: string) => {
    if (next === worksheet.status) return;
    try {
      await actions.setStatus.mutateAsync({ id: wid, status: next });
      toast.success(next === 'DRAFT' ? 'The worksheet is a draft again: you can change it.' : `The worksheet is now ${next === 'READY' ? 'ready' : 'published'}.`);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not change the status.'));
    }
  };
  const set = (patch: Partial<WorksheetDetails>) => setDetails((d) => (d ? { ...d, ...patch } : d));
  const status = !editable ? `${worksheet.status.charAt(0)}${worksheet.status.slice(1).toLowerCase()}, read only`
    : save === 'saving' ? 'Saving details…' : save === 'error' ? 'Details not saved' : 'Details saved';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.name} numberOfLines={2}>{details.title || worksheet.title}</Text>
      <Text style={styles.sub}>{[worksheet.class_name, worksheet.subject_name].filter(Boolean).join('  ·  ')}  ·  {status}</Text>
      {!editable ? (
        <View style={styles.locked}>
          <Text style={[styles.warn, styles.flex]}>This worksheet is {worksheet.status.toLowerCase()}, so it is locked.</Text>
          <Button title="Edit again" size="sm" onPress={() => changeStatus('DRAFT')} disabled={actions.setStatus.isPending} />
        </View>
      ) : null}
      <View style={styles.steps}>
        {([[1, 'Details'], [2, 'Build worksheet']] as const).map(([n, label]) => (
          <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`Step ${n}: ${label}`} accessibilityState={{ selected: step === n }}
            style={[styles.step, step === n && styles.stepOn]} onPress={() => setStep(n)}>
            <Text style={[styles.stepText, step === n && styles.stepTextOn]}>{n}. {label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {step === 1 ? (
        <View style={styles.body}>
          <Select label="Status" value={worksheet.status} disabled={actions.setStatus.isPending} onChange={(v) => changeStatus(String(v))}
            options={WORKSHEET_STATUSES.map((s) => ({ value: s.value as string, label: s.label }))} />
          <Input label="Title" value={details.title} onChangeText={(v) => set({ title: v })} editable={editable} />
          <Input label="Instructions (printed under the header)" value={details.instructions} onChangeText={(v) => set({ instructions: v })}
            multiline editable={editable} placeholder="e.g. Read each question carefully." />
          {!worksheet.subject ? (
            <>
              <Select label="Subject" searchable value={details.subject} disabled={!editable} placeholder="Choose the subject"
                onChange={(v) => set({ subject: Number(v) })} options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
              <Text style={styles.warn}>Needed before you add questions: they are kept in the question bank under a subject.</Text>
            </>
          ) : null}
        </View>
      ) : (
        <BlockPaperEditor kind="worksheet" paperId={wid} title={details.title || worksheet.title} readOnly={!editable}
          classId={worksheet.class_obj} subjectId={worksheet.subject ?? null}
          onCaptured={({ uploadIds, blocks }) => {
            // The scan feedback (which blocks the teacher kept) is recorded for each photographed page, as on the web.
            uploadIds.forEach((uid) => {
              examinationsApi.confirmPaperUpload(uid, { worksheet_id: wid, confirmed_data: { blocks } }).catch(() => undefined);
            });
          }} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  name: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { color: Colors.warning, fontSize: FontSize.sm },
  locked: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  body: { gap: Spacing.sm },
  steps: { flexDirection: 'row', gap: Spacing.xs },
  step: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary },
  stepOn: { backgroundColor: Colors.infoLight, borderWidth: 1, borderColor: Colors.primary },
  stepText: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  stepTextOn: { color: Colors.primary, fontWeight: '600' },
});
