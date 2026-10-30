import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useClassActions, useMasterClassList, useYearSections } from '../../hooks/useClassesAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildMasterPayload, buildSessionPayload, classLabel, deleteWarning, emptyClassForm, GRADE_PRESETS, masterToForm, missingSections, SECTION_LABELS,
  sessionSubtitle, sessionToForm, sortSessionClasses, validateClassForm, withGrade, type ClassForm, type MasterClass, type SessionClassRow,
} from '../../services/classesAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'sections' | 'master';

// Classes of the school. "This year" lists the sections of the active academic year (Class 2 - A,
// Class 2 - B) which every register, timetable and fee run is built on; "All years" holds the
// permanent classes that sections link to. Admin and principal only. The web's section allocator for
// students stays on the web.
export default function ClassSetupScreen() {
  const [tab, setTab] = useState<Tab>('sections');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs<Tab> tabs={[{ value: 'sections', label: 'This year' }, { value: 'master', label: 'All years' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'sections' ? <SectionsTab /> : <MasterTab />}
    </View>
  );
}

function SectionsTab() {
  const toast = useToast();
  const { current: year } = useAcademicYear();
  const q = useYearSections();
  const masters = useMasterClassList();
  const actions = useClassActions();
  const refreshControl = useRefreshControl(q.refetch, masters.refetch);
  const [editing, setEditing] = useState<SessionClassRow | 'new' | null>(null);
  const [form, setForm] = useState<ClassForm>(emptyClassForm());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [grade, setGrade] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>(['A', 'B']);
  const rows = useMemo(() => sortSessionClasses(q.data ?? []), [q.data]);

  if (!year) return <EmptyState title="No academic year" message="Create or activate an academic year on the web first." />;

  const open = (c: SessionClassRow | 'new') => { setForm(c === 'new' ? emptyClassForm() : sessionToForm(c)); setError(null); setEditing(c); };

  const save = async () => {
    const problem = validateClassForm(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildSessionPayload(form, year.id, masters.data ?? []);
      if (editing === 'new') await actions.createSection.mutateAsync(payload);
      else await actions.updateSection.mutateAsync({ id: (editing as SessionClassRow).id, data: payload });
      toast.success('Class saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (c: SessionClassRow) => {
    if (!(await confirm({ title: 'Delete this class?', message: deleteWarning(classLabel(c), c.enrollment_count ?? 0), confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteSection.mutateAsync(c.id);
      toast.success('Class deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the class. Move its students first.')); }
  };

  const initialize = async () => {
    if (!(await confirm({ title: 'Create this year\'s classes from the master classes?', message: `Adds a section for each master class in ${year.name}. Ones that exist are left alone.`, confirmLabel: 'Create' }))) return;
    try {
      const r = await actions.initialize.mutateAsync({ academic_year: year.id });
      toast.success((r.data as { message?: string })?.message || 'Classes created for this year.');
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not create the classes.')); }
  };

  // Several sections of one grade at once; sections that already exist are skipped.
  const quickAdd = async () => {
    if (grade == null) return setError('Choose the grade level.');
    const name = GRADE_PRESETS.find((p) => p.level === grade)?.name ?? '';
    const todo = missingSections(rows, name, picked);
    if (todo.length === 0) return setError('Those sections already exist.');
    setError(null);
    try {
      for (const section of todo) {
        await actions.createSection.mutateAsync(buildSessionPayload({ name, grade: String(grade), section }, year.id, masters.data ?? []));
      }
      toast.success(`Added ${todo.length} section${todo.length === 1 ? '' : 's'}.`);
      setAdding(false);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>{year.name}</Text>
        <View style={styles.pair}>
          <Button title="+ Add class" size="sm" style={styles.half} onPress={() => open('new')} />
          <Button title="+ Sections" size="sm" variant="outline" style={styles.half} onPress={() => { setGrade(null); setPicked(['A', 'B']); setError(null); setAdding(true); }} />
        </View>
        <QueryBoundary query={q} emptyTitle="No classes for this year" emptyMessage="Create them from the master classes, or add them one by one.">
          {() => rows.map((c) => (
            <TouchableOpacity key={c.id} accessibilityRole="button" accessibilityLabel={`${classLabel(c)}. Edit`} style={styles.row} onPress={() => open(c)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{classLabel(c)}</Text>
                <Text style={styles.sub} numberOfLines={2}>{sessionSubtitle(c)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </QueryBoundary>
        {rows.length === 0 && !q.isLoading ? <Button title="Create from master classes" variant="outline" onPress={initialize} loading={actions.initialize.isPending} /> : null}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New class' : 'Edit class'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createSection.isPending || actions.updateSection.isPending} error={error}>
        <Select<string | number> label="Grade level" searchable value={form.grade === '' ? null : Number(form.grade)} placeholder="Choose a grade level"
          onChange={(v) => setForm((f) => withGrade(f, String(v)))} options={GRADE_PRESETS.map((p) => ({ value: p.level, label: p.name }))} />
        <Input label="Class name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
        <Input label="Section (optional)" value={form.section} onChangeText={(v) => setForm((f) => ({ ...f, section: v }))} placeholder="e.g. A" autoCapitalize="characters" />
        {editing && editing !== 'new' ? <Button title="Delete class" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>

      <FormSheet visible={adding} title="Add sections" onClose={() => setAdding(false)} onSubmit={quickAdd} submitLabel="Add" busy={actions.createSection.isPending} error={error}>
        <Select label="Grade level" searchable value={grade} placeholder="Choose a grade level" onChange={(v) => setGrade(Number(v))} options={GRADE_PRESETS.map((p) => ({ value: p.level, label: p.name }))} />
        <Text style={styles.label}>Sections</Text>
        <View style={styles.chips}>
          {SECTION_LABELS.map((s) => (
            <TouchableOpacity key={s} accessibilityRole="button" accessibilityState={{ selected: picked.includes(s) }} accessibilityLabel={`Section ${s}`}
              style={[styles.chip, picked.includes(s) && styles.chipOn]} onPress={() => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}>
              <Text style={[styles.chipText, picked.includes(s) && styles.chipTextOn]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </FormSheet>
    </>
  );
}

function MasterTab() {
  const toast = useToast();
  const { activeSchool } = useAuth();
  const q = useMasterClassList();
  const actions = useClassActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<MasterClass | 'new' | null>(null);
  const [form, setForm] = useState<ClassForm>(emptyClassForm());
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || a.name.localeCompare(b.name)), [q.data]);

  const open = (c: MasterClass | 'new') => { setForm(c === 'new' ? emptyClassForm() : masterToForm(c)); setError(null); setEditing(c); };

  const save = async () => {
    const problem = validateClassForm(form);
    if (problem) return setError(problem);
    if (!activeSchool) return setError('No school is selected.');
    setError(null);
    try {
      const creating = editing === 'new';
      const payload = buildMasterPayload(form, activeSchool.id, creating);
      if (creating) await actions.createMaster.mutateAsync(payload);
      else await actions.updateMaster.mutateAsync({ id: (editing as MasterClass).id, data: payload });
      toast.success('Class saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (c: MasterClass) => {
    if (!(await confirm({ title: 'Delete this class?', message: deleteWarning(c.name, c.student_count ?? 0), confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteMaster.mutateAsync(c.id);
      toast.success('Class deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the class. Move its students first.')); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>Permanent classes. Each year's sections link to these, so results and fees stay with the class over the years.</Text>
        <Button title="+ Add master class" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No classes" emptyMessage="Add classes such as Class 1 to Class 10.">
          {() => rows.map((c) => (
            <TouchableOpacity key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}. Edit`} style={styles.row} onPress={() => open(c)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{c.section ? `${c.name} - ${c.section}` : c.name}</Text>
                <Text style={styles.sub}>{`Grade level ${c.grade_level}  ·  ${c.student_count ?? 0} students`}</Text>
              </View>
              {!c.is_active ? <StatusPill label="Off" tone="neutral" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>
      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New master class' : 'Edit master class'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createMaster.isPending || actions.updateMaster.isPending} error={error}>
        <Select<string | number> label="Grade level" searchable value={form.grade === '' ? null : Number(form.grade)} placeholder="Choose a grade level"
          onChange={(v) => setForm((f) => withGrade(f, String(v)))} options={GRADE_PRESETS.map((p) => ({ value: p.level, label: p.name }))} />
        <Input label="Class name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
        {editing && editing !== 'new' ? <Input label="Section" value={form.section} onChangeText={(v) => setForm((f) => ({ ...f, section: v }))} /> : null}
        {editing && editing !== 'new' ? <Button title="Delete class" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  chips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  chipOn: { backgroundColor: Colors.primary },
  chipText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary },
  chipTextOn: { color: Colors.textInverse },
});
