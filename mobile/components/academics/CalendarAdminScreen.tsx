import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useCalendarActions, useCalendarEntries } from '../../hooks/useCalendarAdmin';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { monthTitle, shiftMonth } from '../../services/manager';
import { todayString } from '../../services/attendanceEntry';
import {
  ENTRY_KINDS, OFF_DAY_TYPES, SCOPES, SWATCHES, buildEntryPayload, emptyEntryForm, entryDatesLine, entryErrorMessage, entryMeta, entryToForm,
  masterClassId, offDayEffect, sortEntries, validateEntry, type CalendarEntry, type EntryForm,
} from '../../services/calendarAdmin';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The school's events and OFF days for a month, with add, edit and delete (admin and principal). An
// OFF day switches attendance off for students and marks staff On leave, so the form says so before
// it is saved. Suggested holidays and the planning views stay on the web.
export default function CalendarAdminScreen() {
  const toast = useToast();
  const { current: year } = useAcademicYear();
  const { options } = useAttendanceClassOptions();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const q = useCalendarEntries(ym.year, ym.month);
  const actions = useCalendarActions();
  const refreshControl = useRefreshControl(q.refetch);

  const [editing, setEditing] = useState<CalendarEntry | 'new' | null>(null);
  const [form, setForm] = useState<EntryForm>(emptyEntryForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof EntryForm>(k: K, v: EntryForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // One entry per master class, however many sections the year has.
  const classChoices = useMemo(() => {
    const seen = new Map<number, string>();
    for (const o of options) {
      const id = masterClassId(o);
      if (id != null && !seen.has(id)) seen.set(id, o.isSession ? o.label.replace(/\s*-\s*[^-]+$/, '') : o.label);
    }
    return Array.from(seen, ([id, label]) => ({ id, label }));
  }, [options]);

  const open = (e: CalendarEntry | 'new') => {
    setForm(e === 'new' ? emptyEntryForm(`${ym.year}-${String(ym.month).padStart(2, '0')}-01` > todayString() ? `${ym.year}-${String(ym.month).padStart(2, '0')}-01` : todayString()) : entryToForm(e));
    setError(null);
    setConfirmDelete(false);
    setEditing(e);
  };

  const save = async () => {
    const problem = validateEntry(form);
    if (problem) return setError(problem);
    if (!year?.id) return setError('There is no current academic year.');
    setError(null);
    try {
      const payload = buildEntryPayload(year.id, form);
      if (editing === 'new') await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as CalendarEntry).id, data: payload });
      toast.success(editing === 'new' ? 'Added to the calendar.' : 'Calendar entry saved.');
      setEditing(null);
    } catch (e) { setError(entryErrorMessage(e, 'Could not save the calendar entry.')); }
  };

  // Two taps: the first asks, the second deletes.
  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await actions.remove.mutateAsync((editing as CalendarEntry).id);
      toast.success('Removed from the calendar.');
      setEditing(null);
    } catch (e) { setError(entryErrorMessage(e, 'Could not delete the entry.')); }
  };

  const effect = offDayEffect(form);
  const busy = actions.create.isPending || actions.update.isPending;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <View style={styles.nav}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setYm(shiftMonth(ym.year, ym.month, -1))}><Text style={styles.arrow}>‹</Text></TouchableOpacity>
          <Text style={styles.title}>{monthTitle(ym.year, ym.month)}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setYm(shiftMonth(ym.year, ym.month, 1))}><Text style={styles.arrow}>›</Text></TouchableOpacity>
        </View>
        <Button title="+ Add event or OFF day" size="sm" onPress={() => open('new')} disabled={!year?.id} style={styles.add} />

        <QueryBoundary query={q} emptyTitle="Nothing this month" emptyMessage="No events or off days are scheduled. Sundays are off automatically.">
          {(list) => sortEntries(list).map((e) => (
            <TouchableOpacity key={e.id} accessibilityRole="button" accessibilityLabel={`${e.name}. Edit`} onPress={() => open(e)}>
              <Card style={styles.row}>
                <View style={[styles.dot, { backgroundColor: e.color || Colors.primary }]} />
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={2}>{e.name}</Text>
                  <Text style={styles.sub}>{entryDatesLine(e)}</Text>
                  <Text style={styles.sub} numberOfLines={2}>{entryMeta(e)}</Text>
                </View>
                {e.entry_kind === 'OFF_DAY' ? <StatusPill label="Off day" tone="warning" /> : null}
              </Card>
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'Add to the calendar' : 'Edit calendar entry'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={busy} error={error}>
        <Input label="Title" value={form.name} onChangeText={(v) => set('name', v)} placeholder="Independence Day, Eid holiday, Sports day" />
        <Select label="Type" value={form.kind} options={ENTRY_KINDS} onChange={(v) => { set('kind', v as EntryForm['kind']); set('color', v === 'OFF_DAY' ? '#dc2626' : '#0ea5e9'); }} />
        {form.kind === 'OFF_DAY' ? <Select label="OFF day category" value={form.offType} options={OFF_DAY_TYPES} onChange={(v) => set('offType', String(v))} /> : null}
        <DateField label="Start date" value={form.start} onChange={(v) => setForm((f) => ({ ...f, start: v, end: f.end < v ? v : f.end }))} />
        <DateField label="End date" value={form.end} onChange={(v) => set('end', v)} />
        <Select label="Applies to" value={form.scope} options={SCOPES} onChange={(v) => setForm((f) => ({ ...f, scope: v as EntryForm['scope'], classIds: [] }))} />
        {form.scope === 'CLASS' ? (
          <View style={styles.classes}>
            {classChoices.map((c) => {
              const on = form.classIds.includes(c.id);
              return (
                <TouchableOpacity key={c.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.chip, on && styles.chipOn]}
                  onPress={() => set('classIds', on ? form.classIds.filter((x) => x !== c.id) : [...form.classIds, c.id])}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        {form.kind === 'OFF_DAY' ? (
          <View style={styles.classes}>
            {([['students', 'Students'], ['staff', 'Staff']] as const).map(([key, label]) => (
              <TouchableOpacity key={key} accessibilityRole="checkbox" accessibilityState={{ checked: form[key] }} style={[styles.chip, form[key] && styles.chipOn]} onPress={() => set(key, !form[key])}>
                <Text style={[styles.chipText, form[key] && styles.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <View style={styles.swatches}>
          {SWATCHES.map((hex) => (
            <TouchableOpacity key={hex} accessibilityRole="button" accessibilityLabel={`Colour ${hex}`} accessibilityState={{ selected: form.color === hex }} onPress={() => set('color', hex)}
              style={[styles.swatch, { backgroundColor: hex }, form.color === hex && styles.swatchOn]} />
          ))}
        </View>
        <Input label="Description (optional)" value={form.description} onChangeText={(v) => set('description', v)} multiline style={styles.area} />
        {effect ? <Text style={styles.effect}>{effect}</Text> : null}
        {editing && editing !== 'new' ? <Button title={confirmDelete ? 'Tap again to delete' : 'Delete entry'} variant="danger" size="sm" onPress={remove} loading={actions.remove.isPending} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  arrow: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.md },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  add: { alignSelf: 'flex-start', marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  classes: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.textInverse },
  swatches: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  swatchOn: { borderWidth: 3, borderColor: Colors.text },
  area: { minHeight: 64, textAlignVertical: 'top' },
  effect: { fontSize: FontSize.sm, color: Colors.warning, backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
});
