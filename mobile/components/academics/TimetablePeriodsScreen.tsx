import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTimetableActions, useTimetableSlots } from '../../hooks/useTimetableEdit';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildSlotPayload, DAY_SHORT, EDIT_DAYS, emptySlotForm, nextSlotOrder, overlappingSlots, SLOT_TYPES, slotRunsOn, slotTimes, slotToForm, toggleDay,
  validateSlot, type Slot, type SlotForm,
} from '../../services/timetableEdit';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The periods and breaks of the school day: name, kind, times, order and the days each runs. Every
// class timetable is built from these. Admin and principal only. Deleting a period that classes use
// is refused by the server; switch it off from the web if it must stop.
export default function TimetablePeriodsScreen() {
  const toast = useToast();
  const q = useTimetableSlots();
  const actions = useTimetableActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Slot | 'new' | null>(null);
  const [form, setForm] = useState<SlotForm>(emptySlotForm(1));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SlotForm>(k: K, v: SlotForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const slots = useMemo(() => [...(q.data ?? [])].sort((a, b) => a.order - b.order), [q.data]);
  const overlaps = useMemo(() => overlappingSlots(slots), [slots]);

  const open = (s: Slot | 'new') => { setForm(s === 'new' ? emptySlotForm(nextSlotOrder(slots)) : slotToForm(s)); setError(null); setEditing(s); };

  const save = async () => {
    const editingId = editing && editing !== 'new' ? editing.id : null;
    const problem = validateSlot(form, slots, editingId);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildSlotPayload(form);
      if (editing === 'new') await actions.createSlot.mutateAsync(payload);
      else await actions.updateSlot.mutateAsync({ id: (editing as Slot).id, data: payload });
      toast.success('Period saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (s: Slot) => {
    if (!(await confirm({ title: 'Delete this period?', message: `${s.name}. Timetables that use it lose it.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteSlot.mutateAsync(s.id);
      toast.success('Period deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the period.')); }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Button title="+ Add period or break" size="sm" onPress={() => open('new')} />
        {overlaps.length > 0 ? <View style={styles.warn} accessibilityRole="alert">{overlaps.map((o) => <Text key={o} style={styles.warnText}>{o}</Text>)}</View> : null}
        <QueryBoundary query={q} emptyTitle="No periods" emptyMessage="Add the periods and breaks of the school day, for example Period 1 at 08:00.">
          {() => slots.map((s) => (
            <TouchableOpacity key={s.id} accessibilityRole="button" accessibilityLabel={`${s.name}, ${slotTimes(s)}. Edit`} style={styles.row} onPress={() => open(s)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{`${s.order}. ${s.name}`}</Text>
                <Text style={styles.sub} numberOfLines={1}>{`${slotTimes(s)}  ·  ${EDIT_DAYS.filter((d) => slotRunsOn(s, d)).map((d) => DAY_SHORT[d]).join(' ')}`}</Text>
              </View>
              {s.slot_type !== 'PERIOD' ? <StatusPill label={s.slot_type.charAt(0) + s.slot_type.slice(1).toLowerCase()} tone="info" /> : null}
              {!s.is_active ? <StatusPill label="Off" tone="neutral" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New period' : 'Edit period'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createSlot.isPending || actions.updateSlot.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Period 1" />
        <Select label="Kind" value={form.type} onChange={(v) => set('type', String(v))} options={SLOT_TYPES} />
        <Input label="Starts (24-hour)" value={form.start} onChangeText={(v) => set('start', v)} placeholder="08:00" keyboardType="numbers-and-punctuation" />
        <Input label="Ends (24-hour)" value={form.end} onChangeText={(v) => set('end', v)} placeholder="08:40" keyboardType="numbers-and-punctuation" />
        <Input label="Order in the day" value={form.order} onChangeText={(v) => set('order', v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Text style={styles.label}>Runs on</Text>
        <View style={styles.days}>
          {EDIT_DAYS.map((d) => (
            <TouchableOpacity key={d} accessibilityRole="button" accessibilityState={{ selected: form.days.includes(d) }} accessibilityLabel={d}
              style={[styles.day, form.days.includes(d) && styles.dayActive]} onPress={() => set('days', toggleDay(form.days, d))}>
              <Text style={[styles.dayText, form.days.includes(d) && styles.dayTextActive]}>{DAY_SHORT[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {editing && editing !== 'new' ? <Button title="Delete period" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 2 },
  warnText: { color: Colors.warningText, fontSize: FontSize.sm },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  days: { flexDirection: 'row', gap: Spacing.xs },
  day: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  dayActive: { backgroundColor: Colors.primary },
  dayText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  dayTextActive: { color: Colors.textInverse },
});
