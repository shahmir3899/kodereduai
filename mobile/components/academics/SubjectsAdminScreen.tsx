import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useStaffPicker } from '../../hooks/useHrAdmin';
import { useSectionClassTeachers, useSectionSubjects, useSubjectActions, useSubjectList } from '../../hooks/useSubjectsAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildClassSubjectPayload, buildClassTeacherPayload, buildSubjectPayload, classSubjectSubtitle, classSubjectToForm, emptyClassSubjectForm, emptySubjectForm,
  subjectSubtitle, subjectToForm, totalPeriods, unassignedSubjects, validateClassSubject, validateClassTeacher, validateSubject,
  type ClassSubjectForm, type ClassSubjectRow, type Scope, type Subject, type SubjectForm,
} from '../../services/subjectsAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'subjects' | 'classes';

// Subjects the school teaches, and which subjects each class section studies with which teacher and
// how many periods a week. Admin and principal only. Deleting a subject switches it off (the server
// keeps it for old results and timetables). The AI workload and gap analysis stay on the web.
export default function SubjectsAdminScreen() {
  const [tab, setTab] = useState<Tab>('subjects');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs<Tab> tabs={[{ value: 'subjects', label: 'Subjects' }, { value: 'classes', label: 'By class' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'subjects' ? <SubjectsTab /> : <ClassesTab />}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function SubjectsTab() {
  const toast = useToast();
  const q = useSubjectList();
  const actions = useSubjectActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const [form, setForm] = useState<SubjectForm>(emptySubjectForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SubjectForm>(k: K, v: SubjectForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const open = (s: Subject | 'new') => { setForm(s === 'new' ? emptySubjectForm() : subjectToForm(s)); setError(null); setEditing(s); };

  const save = async () => {
    const problem = validateSubject(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const creating = editing === 'new';
      const payload = buildSubjectPayload(form, creating);
      if (creating) await actions.createSubject.mutateAsync(payload);
      else await actions.updateSubject.mutateAsync({ id: (editing as Subject).id, data: payload });
      toast.success('Subject saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (s: Subject) => {
    if (!(await confirm({ title: 'Switch off this subject?', message: `${s.name} stops being offered. Old results and timetables keep it.`, confirmLabel: 'Switch off', destructive: true }))) return;
    try {
      await actions.deleteSubject.mutateAsync(s.id);
      toast.success('Subject switched off.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not switch off the subject.')); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Button title="+ Add subject" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No subjects" emptyMessage="Add the subjects your school teaches, for example Maths and English.">
          {(list) => list.map((s) => (
            <TouchableOpacity key={s.id} accessibilityRole="button" accessibilityLabel={`${s.name}. Edit`} style={styles.row} onPress={() => open(s)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{subjectSubtitle(s)}</Text>
              </View>
              {!s.is_active ? <StatusPill label="Off" tone="neutral" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>
      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New subject' : 'Edit subject'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createSubject.isPending || actions.updateSubject.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Mathematics" />
        <Input label="Short code" value={form.code} onChangeText={(v) => set('code', v)} autoCapitalize="characters" placeholder="e.g. MATH" />
        <Input label="Description (optional)" value={form.description} onChangeText={(v) => set('description', v)} />
        <Toggle label="Elective (students choose it)" value={form.isElective} onChange={(v) => set('isElective', v)} />
        {editing && editing !== 'new' ? <Toggle label="Active" value={form.isActive} onChange={(v) => set('isActive', v)} /> : null}
        {editing && editing !== 'new' && editing.is_active ? <Button title="Switch off subject" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

function ClassesTab() {
  const toast = useToast();
  const { year, options } = useAttendanceClassOptions();
  const [optionId, setOptionId] = useState<number | null>(null);
  const option = options.find((o) => o.id === optionId) ?? null;
  const scope: Scope | null = option
    ? { sessionClass: option.isSession ? option.id : null, classObj: option.isSession ? option.classObj : option.id, academicYear: option.isSession ? year.current?.id ?? null : null }
    : null;
  const subjects = useSubjectList();
  const rows = useSectionSubjects(scope);
  const classTeachers = useSectionClassTeachers(scope);
  const staff = useStaffPicker();
  const actions = useSubjectActions();
  const refreshControl = useRefreshControl(rows.refetch, classTeachers.refetch);
  const [editing, setEditing] = useState<ClassSubjectRow | 'new' | null>(null);
  const [form, setForm] = useState<ClassSubjectForm>(emptyClassSubjectForm());
  const [error, setError] = useState<string | null>(null);
  const [addingTeacher, setAddingTeacher] = useState(false);
  const [teacher, setTeacher] = useState<number | null>(null);

  const staffOptions = useMemo(() => (staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name })), [staff.data]);
  const open = (r: ClassSubjectRow | 'new') => { setForm(r === 'new' ? emptyClassSubjectForm() : classSubjectToForm(r)); setError(null); setEditing(r); };

  const save = async () => {
    if (!scope) return;
    const problem = validateClassSubject(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      if (editing === 'new') await actions.createClassSubject.mutateAsync(buildClassSubjectPayload(form, scope));
      else await actions.updateClassSubject.mutateAsync({ id: (editing as ClassSubjectRow).id, data: { teacher: form.teacher, periods_per_week: Number(form.periods) } });
      toast.success('Saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (r: ClassSubjectRow) => {
    if (!(await confirm({ title: 'Remove this subject from the class?', message: r.subject_name, confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await actions.deleteClassSubject.mutateAsync(r.id);
      toast.success('Removed.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not remove the subject.')); }
  };

  const addTeacher = async () => {
    if (!scope) return;
    const problem = validateClassTeacher(teacher, scope, classTeachers.data ?? []);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.createClassTeacher.mutateAsync(buildClassTeacherPayload(teacher as number, scope));
      toast.success('Class teacher added.');
      setAddingTeacher(false);
      setTeacher(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const removeTeacher = async (id: number, name: string) => {
    if (!(await confirm({ title: 'Remove class teacher?', message: name, confirmLabel: 'Remove', destructive: true }))) return;
    try { await actions.deleteClassTeacher.mutateAsync(id); toast.success('Class teacher removed.'); } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not remove the class teacher.')); }
  };

  const existing = editing && editing !== 'new' ? editing : null;
  const pickable = unassignedSubjects(subjects.data ?? [], rows.data ?? [], existing?.subject ?? null);

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Select label="Class" searchable value={optionId} onChange={(v) => setOptionId(Number(v))} placeholder="Choose a class" options={options.map((o) => ({ value: o.id, label: o.label }))} />
        {scope == null ? <Text style={styles.sub}>Choose a class to see its subjects.</Text> : (
          <>
            {scope.sessionClass != null ? (
              <View style={styles.block}>
                <Text style={styles.section}>Class teacher</Text>
                <QueryBoundary query={classTeachers} isEmpty={() => false}>
                  {(list) => (
                    <>
                      {list.length === 0 ? <Text style={styles.sub}>No class teacher yet.</Text> : list.map((c) => (
                        <View key={c.id} style={styles.line}>
                          <Text style={styles.name}>{c.teacher_name ?? `Teacher ${c.teacher}`}</Text>
                          <Button title="Remove" size="sm" variant="ghost" onPress={() => removeTeacher(c.id, c.teacher_name ?? '')} />
                        </View>
                      ))}
                      <Button title="+ Class teacher" size="sm" variant="outline" onPress={() => { setTeacher(null); setError(null); setAddingTeacher(true); }} />
                    </>
                  )}
                </QueryBoundary>
              </View>
            ) : null}
            <View style={styles.block}>
              <Text style={styles.section}>Subjects</Text>
              <QueryBoundary query={rows} emptyTitle="No subjects yet" emptyMessage="Add the subjects this class studies.">
                {(list) => (
                  <>
                    <Text style={styles.sub}>{`${list.length} subjects, ${totalPeriods(list)} periods a week`}</Text>
                    {list.map((r) => (
                      <TouchableOpacity key={r.id} accessibilityRole="button" accessibilityLabel={`${r.subject_name}. Edit`} style={styles.row} onPress={() => open(r)}>
                        <View style={styles.who}>
                          <Text style={styles.name} numberOfLines={1}>{r.subject_name}</Text>
                          <Text style={styles.sub} numberOfLines={1}>{classSubjectSubtitle(r)}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </QueryBoundary>
              <Button title="+ Add subject to this class" size="sm" onPress={() => open('new')} />
            </View>
          </>
        )}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'Add subject to class' : existing?.subject_name ?? ''} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createClassSubject.isPending || actions.updateClassSubject.isPending} error={error}>
        {editing === 'new' ? (
          <Select label="Subject" searchable value={form.subject} onChange={(v) => setForm((f) => ({ ...f, subject: Number(v) }))} placeholder="Choose a subject"
            options={pickable.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
        ) : null}
        <Select<string | number> label="Teacher (optional)" searchable value={form.teacher} placeholder="No teacher yet"
          onChange={(v) => setForm((f) => ({ ...f, teacher: v === '' ? null : Number(v) }))} options={[{ value: '', label: 'No teacher yet' }, ...staffOptions]} />
        <Input label="Periods per week" value={form.periods} onChangeText={(v) => setForm((f) => ({ ...f, periods: v.replace(/\D/g, '') }))} keyboardType="number-pad" />
        {existing ? <Button title="Remove from class" variant="danger" size="sm" onPress={() => remove(existing)} /> : null}
      </FormSheet>

      <FormSheet visible={addingTeacher} title="Add class teacher" onClose={() => setAddingTeacher(false)} onSubmit={addTeacher} submitLabel="Add" busy={actions.createClassTeacher.isPending} error={error}>
        <Select label="Teacher" searchable value={teacher} onChange={(v) => setTeacher(Number(v))} placeholder="Choose a teacher" options={staffOptions} />
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  block: { gap: Spacing.sm },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
});
