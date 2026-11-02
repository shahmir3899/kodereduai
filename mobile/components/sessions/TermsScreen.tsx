import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAllTerms, useManagedYears, useSessionActions } from '../../hooks/useAcademicSessions';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildImportPayload, buildTermPayload, canApplyImport, CONFLICT_MODES, emptyImportForm, formatDay, importResultText, newTermForm,
  TERM_TYPES, termClashes, termToForm, validateImport, validateTerm, warningsToConfirm,
  type ImportForm, type ImportPreview, type ManagedTerm, type TermForm,
} from '../../services/academicSessions';
import { coverageSummary, findGaps, stepEdge, termDays, TERM_COLOURS, type Edge, type Span } from '../../services/yearTimeline';
import { inventoryErrorMessage } from '../../services/inventory';
import { schoolToday } from '../../services/schoolTime';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import YearTimeline from './YearTimeline';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const AUTOSAVE_MS = 700;
type Status = 'idle' | 'saving' | 'saved' | 'held' | 'error';

const snapshot = (f: TermForm) => JSON.stringify([f.name.trim(), f.termType, Number(f.order) || 1, f.startDate, f.endDate]);

// One academic year's terms on one screen, like the web: a bar to drag the selected term's edges on, the
// terms as chips, and the selected term's fields below. Edits save by themselves a moment after you stop;
// an overlap is only a warning, so that change is held back with a "Save anyway" button.
export default function TermsScreen() {
  const { yearId } = useLocalSearchParams<{ yearId?: string }>();
  const id = Number(yearId) || null;
  const toast = useToast();
  const years = useManagedYears();
  const all = useAllTerms();
  const actions = useSessionActions();
  const refreshControl = useRefreshControl(async () => { await Promise.all([years.refetch(), all.refetch()]); });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<TermForm | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const savedRef = useRef('');
  const startedRef = useRef(false);
  const [importing, setImporting] = useState<ImportForm | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const year = (years.data ?? []).find((y) => y.id === id) ?? null;
  const terms = useMemo(() => (all.data ?? []).filter((t) => t.academic_year === id).sort((a, b) => a.order - b.order), [all.data, id]);
  const others = terms.filter((t) => t.id !== selectedId);
  const problem = form && year ? validateTerm(form, year) : null;
  const clashes = form && !problem ? termClashes(form, others) : [];
  const warnings = [...new Set([
    ...clashes.map((t) => `These dates overlap ${t.name} (${formatDay(t.start_date)} - ${formatDay(t.end_date)}).`), ...serverWarnings,
  ])];
  const dirty = !!form && snapshot(form) !== savedRef.current;
  const valid = !!form && !problem;

  // The selected term is drawn from the live form, so dragging and typing move the same bar.
  const drawn = useMemo(() => terms.map((t) => (t.id === selectedId && form && form.startDate < form.endDate
    ? { ...t, name: form.name || t.name, start_date: form.startDate, end_date: form.endDate } : t)), [terms, selectedId, form]);

  const persist = useCallback(async (termId: number, f: TermForm, confirmed = false) => {
    const sent = snapshot(f);
    setStatus('saving'); setError(null); setServerWarnings([]);
    try {
      await actions.updateTerm.mutateAsync({ id: termId, data: buildTermPayload(f, null, confirmed) });
      savedRef.current = sent;
      setStatus('saved');
    } catch (e) {
      const asked = warningsToConfirm(e);
      if (asked) { setServerWarnings(asked); setStatus('held'); } else { setError(inventoryErrorMessage(e, 'Could not save the term.')); setStatus('error'); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.updateTerm]);

  // Autosave: a valid, non-overlapping change goes out once the admin pauses.
  const key = form ? snapshot(form) : '';
  useEffect(() => {
    if (!form || !dirty) return undefined;
    if (!valid) { setStatus('error'); return undefined; }
    if (clashes.length || serverWarnings.length) { setStatus('held'); return undefined; }
    setStatus('saving');
    const timer = setTimeout(() => persist(selectedId as number, form), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selectedId, valid, clashes.length, serverWarnings.length]);

  // Leaving the screen mid-pause must not lose the last edit.
  const latest = useRef({ selectedId, form, dirty, valid, clashes: 0, persist });
  latest.current = { selectedId, form, dirty, valid, clashes: clashes.length + serverWarnings.length, persist };
  useEffect(() => () => {
    const l = latest.current;
    if (l.selectedId && l.form && l.dirty && l.valid && !l.clashes) l.persist(l.selectedId, l.form);
  }, []);

  const choose = useCallback((t: ManagedTerm) => {
    setSelectedId(t.id);
    const f = termToForm(t);
    setForm(f);
    savedRef.current = snapshot(f);
    setError(null); setServerWarnings([]); setStatus('idle');
  }, []);

  // Open on the first term so its handles are there to drag.
  useEffect(() => {
    if (!startedRef.current && terms.length) { startedRef.current = true; choose(terms[0]); }
  }, [terms, choose]);

  const select = async (termId: number) => {
    if (termId === selectedId) return;
    const t = terms.find((x) => x.id === termId);
    if (!t) return;
    if (dirty && valid && !clashes.length && !serverWarnings.length) await persist(selectedId as number, form as TermForm);
    else if (dirty && !(await confirm({ title: 'Discard changes?', message: 'This term has changes that were not saved. Discard them?', confirmLabel: 'Discard', destructive: true }))) return;
    choose(t);
  };

  const set = (patch: Partial<TermForm>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setServerWarnings([]); };
  const setRange = (r: Span) => set({ startDate: r.start_date, endDate: r.end_date });
  const step = (edge: Edge, days: number) => { if (form && year) setRange(stepEdge({ start_date: form.startDate, end_date: form.endDate }, edge, days, year)); };

  const addTerm = async () => {
    if (!year) return;
    if (dirty && valid && !clashes.length && !serverWarnings.length) await persist(selectedId as number, form as TermForm);
    const next = newTermForm(year, terms);
    if (!next) return toast.error('Every day of this year is already inside a term. Shorten a term first.');
    try {
      await actions.createTerm.mutateAsync(buildTermPayload(next, year.id, false));
      // The create answer carries no id, so find the new term in the fresh list to select it.
      const fresh = ((await all.refetch()).data ?? []).find((t) => t.academic_year === year.id && t.order === Number(next.order) && t.name === next.name);
      if (fresh) { choose(fresh); setStatus('saved'); }
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not add the term.'));
    }
  };

  const fillGap = async () => {
    if (!year) return;
    const gap = findGaps(terms, year.start_date, year.end_date)[0];
    if (!gap) return;
    const order = Math.max(0, ...terms.map((t) => t.order)) + 1;
    try {
      await actions.createTerm.mutateAsync(buildTermPayload({ name: `Term ${order}`, termType: 'TERM', order: String(order), startDate: gap.start_date, endDate: gap.end_date }, year.id, false));
      const fresh = ((await all.refetch()).data ?? []).find((t) => t.academic_year === year.id && t.order === order);
      if (fresh) { choose(fresh); setStatus('saved'); }
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not add the term.'));
    }
  };

  const removeTerm = async () => {
    const t = terms.find((x) => x.id === selectedId);
    if (!t || !(await confirm({ title: 'Delete term', message: `Delete term "${t.name}"? This cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteTerm.mutateAsync(t.id);
      toast.success('Term deleted.');
      savedRef.current = snapshot(form as TermForm); // nothing left to save for a deleted term
      setSelectedId(null); setForm(null); setStatus('idle'); startedRef.current = false;
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the term.'));
    }
  };

  const openImport = () => { setImporting(emptyImportForm(id)); setPreview(null); setImportError(null); };
  const setImp = <K extends keyof ImportForm>(k: K, v: ImportForm[K]) => { setImporting((f) => (f ? { ...f, [k]: v } : f)); setPreview(null); };

  const runPreview = async () => {
    if (!importing) return;
    const p = validateImport(importing);
    if (p) return setImportError(p);
    setImportError(null);
    try {
      setPreview((await actions.importPreview.mutateAsync(buildImportPayload(importing))).data as ImportPreview);
    } catch (e) {
      setImportError(inventoryErrorMessage(e, 'Could not generate the preview.'));
    }
  };

  const applyImport = async () => {
    if (!importing || !canApplyImport(preview)) return;
    try {
      const res = await actions.importApply.mutateAsync(buildImportPayload(importing));
      toast.success(importResultText(res.data));
      setImporting(null);
      startedRef.current = false;
    } catch (e) {
      setImportError(inventoryErrorMessage(e, 'Could not import the terms.'));
    }
  };

  if (years.isLoading || all.isLoading) return <Skeleton />;
  if (years.isError && !years.data) return <ErrorState error={years.error} onRetry={() => years.refetch()} />;
  if (!year) return <EmptyState title="Year not found" message="Open the year from the Academic Sessions list." />;

  const sources = (years.data ?? []).filter((y) => y.id !== year.id).map((y) => ({ value: y.id, label: y.name }));
  const counts = preview?.counts ?? {};
  const gaps = findGaps(drawn, year.start_date, year.end_date);
  const statusText = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'held' ? 'Not saved: needs your OK' : status === 'error' ? 'Not saved' : '';

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{year.name}</Text>
        <Text style={styles.sub}>{formatDay(year.start_date)} - {formatDay(year.end_date)}</Text>
        <YearTimeline year={year} terms={drawn} today={schoolToday()} selectedId={selectedId} onSelect={select} onRangeChange={form ? setRange : undefined} />
        <Text style={styles.sub}>{coverageSummary(year, drawn)}</Text>
        {form ? <Text style={styles.hint}>Drag the handles under the bar to change the dates, or use the buttons below.</Text> : null}

        <View style={styles.row2}>
          <Button title="+ Add term" size="sm" style={styles.flex} onPress={addTerm} loading={actions.createTerm.isPending} />
          <Button title="Import from a year" size="sm" variant="outline" style={styles.flex} onPress={openImport} />
        </View>
        {gaps.length > 0 && terms.length > 0 ? <Button title={`Add a term for ${formatDay(gaps[0].start_date)} - ${formatDay(gaps[0].end_date)}`} size="sm" variant="outline" onPress={fillGap} /> : null}

        {terms.length === 0 ? <EmptyState title="No terms" message="Add the first term, or import them from another year." /> : (
          <View style={styles.chips}>
            {terms.map((t, i) => (
              <TouchableOpacity key={t.id} accessibilityRole="button" accessibilityLabel={`Select ${t.name}`} onPress={() => select(t.id)}
                style={[styles.chip, t.id === selectedId && styles.chipOn]}>
                <View style={[styles.dot, { backgroundColor: TERM_COLOURS[i % TERM_COLOURS.length] }]} />
                <Text style={styles.chipText} numberOfLines={1}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {form ? (
          <View style={styles.editor}>
            <View style={styles.editorHead}>
              <Text style={styles.editorTitle}>Edit term</Text>
              {statusText ? <StatusPill label={statusText} tone={status === 'saved' ? 'success' : status === 'saving' ? 'info' : 'warning'} /> : null}
            </View>
            <Input label="Name" value={form.name} onChangeText={(v) => set({ name: v })} />
            <Select label="Type" value={form.termType} onChange={(v) => set({ termType: String(v) })} options={TERM_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
            <Input label="Order" value={form.order} onChangeText={(v) => set({ order: v })} keyboardType="number-pad" />
            <EdgeFields label="Start date" value={form.startDate} onChange={(v) => set({ startDate: v })} onStep={(d) => step('start', d)} />
            <EdgeFields label="End date" value={form.endDate} onChange={(v) => set({ endDate: v })} onStep={(d) => step('end', d)} />
            {form.startDate < form.endDate ? <Text style={styles.sub}>{termDays({ start_date: form.startDate, end_date: form.endDate })} days</Text> : null}
            {problem ? <Text style={styles.problem} accessibilityRole="alert">{problem}</Text> : null}
            {error ? <Text style={styles.problem} accessibilityRole="alert">{error}</Text> : null}
            {warnings.length ? (
              <View style={styles.warn}>
                {warnings.map((w) => <Text key={w} style={styles.warnText}>{w}</Text>)}
                <Button title="Save anyway" size="sm" onPress={() => persist(selectedId as number, form, true)} />
              </View>
            ) : null}
            <Button title="Delete term" variant="danger" size="sm" onPress={removeTerm} />
          </View>
        ) : null}
      </ScrollView>

      <FormSheet visible={importing !== null} title="Import terms from a year" onClose={() => setImporting(null)}
        onSubmit={canApplyImport(preview) ? applyImport : runPreview} submitLabel={canApplyImport(preview) ? 'Import terms' : 'Preview import'}
        busy={actions.importPreview.isPending || actions.importApply.isPending} error={importError}>
        {importing ? (
          <>
            <Text style={styles.sub}>Into {year.name}</Text>
            <Select label="Copy terms from" value={importing.sourceYearId} onChange={(v) => setImp('sourceYearId', Number(v))} placeholder="Choose a year" options={sources} />
            <Select label="If a term already exists" value={importing.conflictMode} onChange={(v) => setImp('conflictMode', String(v))} options={CONFLICT_MODES.map((c) => ({ value: c.value, label: c.label }))} />
            <View style={styles.toggle}>
              <Text style={styles.toggleLabel}>Include inactive terms</Text>
              <Switch value={importing.includeInactive} onValueChange={(v) => setImp('includeInactive', v)} accessibilityLabel="Include inactive terms" />
            </View>
            {preview ? (
              <View style={styles.preview}>
                <View style={styles.pills}>
                  <StatusPill label={`Create ${counts.create ?? 0}`} tone="success" />
                  <StatusPill label={`Update ${counts.update ?? 0}`} tone="warning" />
                  <StatusPill label={`Skip ${counts.skip ?? 0}`} tone="neutral" />
                  <StatusPill label={`Conflict ${counts.conflict ?? 0}`} tone="error" />
                </View>
                {(counts.conflict ?? 0) > 0 ? <Text style={styles.warnText}>There are conflicts (duplicate order or overlapping dates). Fix the terms in this year or change the option above.</Text> : null}
                {(preview.terms ?? []).map((r) => (
                  <View key={r.source_term_id} style={styles.previewRow}>
                    <Text style={styles.name}>{r.name}  ·  {r.action}</Text>
                    <Text style={styles.sub}>{formatDay(r.start_date)} - {formatDay(r.end_date)}{r.reason ? `  ·  ${r.reason}` : ''}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </FormSheet>
    </>
  );
}

// A date field with day-by-day buttons: a finger cannot always land on one day of a year-wide bar.
function EdgeFields({ label, value, onChange, onStep }: { label: string; value: string; onChange: (v: string) => void; onStep: (days: number) => void }) {
  return (
    <View style={styles.edge}>
      <DateField label={label} value={value} onChange={onChange} />
      <View style={styles.steps}>
        {[-7, -1, 1, 7].map((d) => (
          <TouchableOpacity key={d} accessibilityRole="button" accessibilityLabel={`${label} ${d > 0 ? 'plus' : 'minus'} ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`} style={styles.step} onPress={() => onStep(d)}>
            <Text style={styles.stepText}>{d > 0 ? `+${d}` : d}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  flex: { flex: 1 },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary },
  row2: { flexDirection: 'row', gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: 'transparent' },
  chipOn: { borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, maxWidth: 160 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  editor: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm },
  editorHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editorTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  edge: { gap: 4 },
  steps: { flexDirection: 'row', gap: Spacing.sm },
  step: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.primary },
  stepText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  problem: { fontSize: FontSize.sm, color: Colors.errorText },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.sm, padding: Spacing.md, gap: Spacing.xs },
  warnText: { fontSize: FontSize.sm, color: Colors.warningText },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
  preview: { gap: Spacing.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  previewRow: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm },
});
