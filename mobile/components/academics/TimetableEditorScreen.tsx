import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useStaffPicker } from '../../hooks/useHrAdmin';
import { useSectionSubjects } from '../../hooks/useSubjectsAdmin';
import { useEditableTimetable, useQualityScore, useTimetableActions, useTimetableSlots } from '../../hooks/useTimetableEdit';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  bulkSavePayload, DAY_NAMES, DAY_SHORT, dayChanged, draftFromEntries, EDIT_DAYS, emptyCell, filledCount, hasOverride, isLessonSlot,
  saveErrorLines, setCell, slotsForDay, slotTimes, type Cell, type Draft, type EditDay, type Slot,
} from '../../services/timetableEdit';
import { dayCodeFor } from '../../services/teacher';
import { inventoryErrorMessage } from '../../services/inventory';
import { conflictParams, hasSharedEntries, showScore, splitResultText, type ConflictData } from '../../services/timetableWeek';
import Input from '../ui/Input';
import SegmentedTabs from '../ui/SegmentedTabs';
import WeekGrid from './WeekGrid';
import { ClashNotice, ScoreBadge, ScoreSheet, SubstituteSheet } from './TimetableTools';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { academicsApi } from '../../services/api';
import { timetableFileName, timetablePdfParams } from '../../services/pdfDownloads';
import { usePdfShare } from '../../hooks/usePdfShare';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Weekly timetable of one class or section, edited a day at a time. Changes are held on the phone
// until Save day, which replaces that day on the server (as on the web). The server refuses a teacher
// who is already teaching another class in the same period and says which class. Auto-generate and
// AI suggestions stay on the web. Admin and principal only.
export default function TimetableEditorScreen() {
  const router = useRouter();
  const toast = useToast();
  const { year, options, isLoading: optionsLoading } = useAttendanceClassOptions();
  const pdf = usePdfShare();
  const [optionId, setOptionId] = useState<number | null>(null);
  const option = options.find((o) => o.id === (optionId ?? options[0]?.id)) ?? null;
  const classObj = option ? (option.isSession ? option.classObj : option.id) : null;
  const sessionClass = option?.isSession ? option.id : null;
  const [day, setDay] = useState<EditDay>(() => (EDIT_DAYS as readonly string[]).includes(dayCodeFor(new Date())) ? (dayCodeFor(new Date()) as EditDay) : 'MON');

  const slots = useTimetableSlots();
  const entries = useEditableTimetable(classObj, sessionClass);
  const scope = option ? { sessionClass, classObj: classObj as number | null, academicYear: option.isSession ? year.current?.id ?? null : null } : null;
  const classSubjects = useSectionSubjects(scope);
  const staff = useStaffPicker();
  const actions = useTimetableActions();
  const refreshControl = useRefreshControl(entries.refetch, slots.refetch);

  const daySlots = useMemo(() => slotsForDay(slots.data ?? [], day), [slots.data, day]);
  const original = useMemo(() => draftFromEntries(entries.data ?? [], day), [entries.data, day]);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<string[]>([]);
  // The grid on screen follows the server until the person edits; a refetch must not wipe edits.
  const [dirty, setDirty] = useState(false);
  const quality = useQualityScore(classObj, (entries.data ?? []).length > 0 && !dirty);
  useEffect(() => { if (!dirty) setDraft(original); }, [original, dirty]);
  useEffect(() => { setDirty(false); setErrors([]); }, [day, classObj, sessionClass]);

  const [editing, setEditing] = useState<Slot | null>(null);
  const [cell, setCellForm] = useState<Cell>(emptyCell());
  // Day edits one day at a time; Week shows the whole week at a glance and jumps to the day when a lesson is tapped.
  const [view, setView] = useState<'day' | 'week'>('day');
  const [scoreOpen, setScoreOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const changed = dayChanged(original, draft);
  const staffOptions = useMemo(() => (staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name })), [staff.data]);
  const subjectOptions = useMemo(() => (classSubjects.data ?? []).map((r) => ({ value: r.subject, label: r.subject_name })), [classSubjects.data]);

  const open = (s: Slot) => { setCellForm(draft[s.id] ?? emptyCell()); setConflict(null); setEditing(s); };

  const chooseSubject = (subjectId: number) => {
    const row = (classSubjects.data ?? []).find((r) => r.subject === subjectId);
    // The class's usual teacher for the subject is filled in, unless one was already chosen.
    const teacherId = cell.teacher ?? row?.teacher ?? null;
    setCellForm((c) => ({
      ...c, subject: subjectId, subjectName: row?.subject_name ?? '',
      teacher: c.teacher ?? row?.teacher ?? null, teacherName: c.teacher != null ? c.teacherName : row?.teacher_name ?? '',
    }));
    if (cell.teacher == null && teacherId != null) void checkClash(teacherId);
  };

  // As on the web, picking a teacher asks the server whether they already teach another class in this period, so the clash
  // is seen before Save; ignoring a failed check is fine, Save still refuses a real clash.
  const checkClash = async (teacherId: number | null) => {
    setConflict(null);
    if (teacherId == null || !editing || classObj == null) return;
    try {
      const res = (await academicsApi.checkTeacherConflicts(conflictParams(teacherId, day, editing.id, classObj, sessionClass))).data as ConflictData;
      if (res.has_conflict) setConflict(res);
    } catch { /* the save will still refuse a real clash */ }
  };

  const chooseTeacher = (v: string | number) => {
    const id = v === '' ? null : Number(v);
    setCellForm((c) => ({ ...c, teacher: id, teacherName: staffOptions.find((o) => o.value === id)?.label ?? '' }));
    void checkClash(id);
  };

  const pickAlternative = (id: number, name: string) => {
    setCellForm((c) => ({ ...c, teacher: id, teacherName: name }));
    setConflict(null);
  };

  const split = async () => {
    if (classObj == null) return;
    if (!(await confirm({ title: 'Give each section its own timetable?', message: 'The class timetable is copied into each of its sections, and the shared one is removed. Each section can then be changed on its own.', confirmLabel: 'Split' }))) return;
    try {
      const res = await actions.split.mutateAsync({ class_obj: classObj });
      setNotice(splitResultText(res.data));
      setDirty(false);
    } catch (e) { setNotice(inventoryErrorMessage(e, 'Failed to give each section its own timetable.')); }
  };

  const applyCell = () => {
    if (!editing) return;
    setDraft((d) => setCell(d, editing.id, cell.subject == null ? null : cell));
    setDirty(true);
    setEditing(null);
  };

  const clearCell = () => {
    if (!editing) return;
    setDraft((d) => setCell(d, editing.id, null));
    setDirty(true);
    setEditing(null);
  };

  const saveDay = async () => {
    if (!scope || classObj == null) return;
    setErrors([]);
    try {
      await actions.saveDay.mutateAsync(bulkSavePayload({ classObj, sessionClass, academicYear: scope.academicYear }, day, draft, daySlots));
      toast.success(`${DAY_NAMES[day]} saved.`);
      setDirty(false);
    } catch (e) {
      setErrors(saveErrorLines(e));
    }
  };

  const discard = async () => {
    if (!(await confirm({ title: 'Discard your changes?', message: `${DAY_NAMES[day]} goes back to what is saved.`, confirmLabel: 'Discard', destructive: true }))) return;
    setDraft(original);
    setDirty(false);
    setErrors([]);
  };

  const followClass = async () => {
    if (sessionClass == null) return;
    if (!(await confirm({ title: 'Follow the class timetable?', message: `This section's own ${DAY_NAMES[day]} is removed and it uses the class timetable again.`, confirmLabel: 'Remove override', destructive: true }))) return;
    try {
      await actions.clearSectionDay.mutateAsync({ session_class: sessionClass, day });
      toast.success('The section follows the class timetable.');
      setDirty(false);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not remove the override.')); }
  };

  if (optionsLoading || slots.isLoading) return <Skeleton />;
  if (options.length === 0) return <EmptyState title="No classes" message="Add classes first." />;
  if (slots.isError && !slots.data) return <ErrorState error={slots.error} onRetry={() => slots.refetch()} />;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Select label="Class" searchable value={option?.id ?? null} onChange={(v) => { setOptionId(Number(v)); }} options={options.map((o) => ({ value: o.id, label: o.label }))} />
        {showScore(quality.data) ? <ScoreBadge score={quality.data} onPress={() => setScoreOpen(true)} /> : null}
        <SegmentedTabs tabs={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} value={view} onChange={setView} />
        {notice ? <View style={styles.noticeBox}><Text style={styles.sub}>{notice}</Text></View> : null}
        {view === 'week' ? (
          entries.isLoading ? <Skeleton /> : (
            <WeekGrid slots={slots.data ?? []} entries={entries.data ?? []}
              onCellPress={(d, slot) => { setDay(d); setView('day'); open(slot); }} />
          )
        ) : (
        <>
        <View style={styles.days}>
          {EDIT_DAYS.map((d) => (
            <TouchableOpacity key={d} accessibilityRole="button" accessibilityState={{ selected: d === day }} accessibilityLabel={DAY_NAMES[d]} style={[styles.day, d === day && styles.dayActive]} onPress={() => setDay(d)}>
              <Text style={[styles.dayText, d === day && styles.dayTextActive]}>{DAY_SHORT[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {entries.isLoading ? <Skeleton /> : entries.isError && !entries.data ? <ErrorState error={entries.error} onRetry={() => entries.refetch()} /> : (
          <>
            {sessionClass != null && hasOverride(entries.data ?? [], day) ? <StatusPill label="This section has its own timetable for the day" tone="info" /> : null}
            {daySlots.length === 0 ? (
              <EmptyState title="No periods set up" message="Add the periods and breaks of the school day first." />
            ) : daySlots.map((s) => {
              const c = draft[s.id];
              const lesson = isLessonSlot(s);
              return (
                <TouchableOpacity key={s.id} accessibilityRole="button" disabled={!lesson}
                  accessibilityLabel={lesson ? `${s.name}, ${c?.subjectName || 'empty'}. Edit` : s.name} style={[styles.row, !lesson && styles.breakRow]} onPress={() => open(s)}>
                  <View style={styles.time}>
                    <Text style={styles.slotName}>{s.name}</Text>
                    <Text style={styles.timeText}>{slotTimes(s)}</Text>
                  </View>
                  <View style={styles.who}>
                    {!lesson ? <Text style={styles.sub}>{s.slot_type.charAt(0) + s.slot_type.slice(1).toLowerCase()}</Text> : c?.subject != null ? (
                      <>
                        <Text style={styles.name} numberOfLines={1}>{c.subjectName || 'Subject'}</Text>
                        <Text style={styles.sub} numberOfLines={1}>{[c.teacherName || 'No teacher', c.room ? `Room ${c.room}` : null].filter(Boolean).join('  ·  ')}</Text>
                      </>
                    ) : <Text style={styles.empty}>Empty. Tap to set.</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            {errors.length > 0 ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                {errors.map((e) => <Text key={e} style={styles.errorText}>{e}</Text>)}
              </View>
            ) : null}

            {daySlots.length > 0 ? (
              <>
                <Text style={styles.sub}>{`${filledCount(draft)} of ${daySlots.filter(isLessonSlot).length} periods filled${changed ? '  ·  not saved yet' : ''}`}</Text>
                <Button title={`Save ${DAY_NAMES[day]}`} onPress={saveDay} loading={actions.saveDay.isPending} disabled={!changed || actions.saveDay.isPending} />
                {changed ? <Button title="Discard changes" variant="outline" size="sm" onPress={discard} /> : null}
                {sessionClass != null && hasOverride(entries.data ?? [], day) ? <Button title="Follow the class timetable" variant="ghost" size="sm" onPress={followClass} /> : null}
              </>
            ) : null}
          </>
        )}
        </>
        )}
        {option ? (
          <Button title="Timetable PDF" variant="outline" loading={pdf.busy} disabled={pdf.busy || timetablePdfParams(classObj, sessionClass) == null}
            onPress={() => pdf.share(() => academicsApi.downloadTimetablePdf(timetablePdfParams(classObj, sessionClass) as Record<string, unknown>) as Promise<{ data: ArrayBuffer }>, timetableFileName(option.label))} />
        ) : null}
        <Button title="Periods and breaks" variant="outline" onPress={() => router.push('/(admin)/timetable-periods' as Href)} />
        <Button title="Find a substitute" variant="outline" onPress={() => setSubOpen(true)} />
        {sessionClass != null && hasSharedEntries(entries.data ?? []) && (entries.data ?? []).length > 0 ? (
          <Button title="Give each section its own timetable" variant="outline" onPress={split} loading={actions.split.isPending} />
        ) : null}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing ? `${editing.name}  ·  ${slotTimes(editing)}` : ''} onClose={() => setEditing(null)} onSubmit={applyCell} submitLabel="Set period">
        <Select label="Subject" searchable value={cell.subject} onChange={(v) => chooseSubject(Number(v))} placeholder="Choose a subject" options={subjectOptions} />
        {subjectOptions.length === 0 ? <Text style={styles.sub}>This class has no subjects yet. Add them under Subjects, By class.</Text> : null}
        <Select<string | number> label="Teacher" searchable value={cell.teacher} placeholder="No teacher" onChange={chooseTeacher} options={[{ value: '', label: 'No teacher' }, ...staffOptions]} />
        <ClashNotice conflict={conflict} params={{ teacher: cell.teacher, day, slot: editing?.id, class_id: classObj, subject: cell.subject ?? undefined }} onPickTeacher={pickAlternative} />
        <Input label="Room (optional)" value={cell.room} onChangeText={(v) => setCellForm((c) => ({ ...c, room: v }))} />
        {draft[editing?.id ?? -1] ? <Button title="Clear this period" variant="danger" size="sm" onPress={clearCell} /> : null}
      </FormSheet>

      <ScoreSheet visible={scoreOpen} onClose={() => setScoreOpen(false)} score={quality.data ?? null} />
      <SubstituteSheet visible={subOpen} onClose={() => setSubOpen(false)} teachers={staffOptions} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  days: { flexDirection: 'row', gap: Spacing.xs },
  day: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.surface },
  dayActive: { backgroundColor: Colors.primary },
  dayText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  dayTextActive: { color: Colors.textInverse },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 60 },
  breakRow: { backgroundColor: Colors.surfaceSecondary },
  time: { width: 96 },
  slotName: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  timeText: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  empty: { fontSize: FontSize.sm, color: Colors.textTertiary },
  noticeBox: { backgroundColor: Colors.infoLight, borderRadius: BorderRadius.md, padding: Spacing.md },
  errorBox: { backgroundColor: Colors.errorLight, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  errorText: { color: Colors.errorText, fontSize: FontSize.sm },
});
