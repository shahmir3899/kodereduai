import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRenumberApply, useRenumberPreview } from '../../hooks/useRenumber';
import {
  RENUMBER_ORDERS, applyPayload, attendanceNote, changedRows, manualRows, moveId, renumberConfirmText, renumberErrorText, renumberResultText,
  studentIdsOf, type RenumberOrder,
} from '../../services/renumber';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Select from '../ui/Select';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Numbers one section's students 1, 2, 3... in the order chosen, after a preview. Only a School Admin
// or Principal may (the server checks). Nothing is written until the confirmed Apply.
export default function RenumberSectionSheet({ visible, onClose, section }: { visible: boolean; onClose: () => void; section: { id: number; label: string } }) {
  const toast = useToast();
  const [order, setOrder] = useState<RenumberOrder>('alphabetical');
  const [manualIds, setManualIds] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRenumberPreview(section.id, order, visible);
  const apply = useRenumberApply();
  const base = useMemo(() => preview.data?.changes ?? [], [preview.data]);

  useEffect(() => { if (visible) { setOrder('alphabetical'); setManualIds(null); setError(null); } }, [visible, section.id]);
  // Manual mode starts from the current roll order the server just previewed.
  useEffect(() => { if (order === 'manual' && manualIds === null && base.length > 0) setManualIds(studentIdsOf(base)); }, [order, manualIds, base]);

  const rows = order === 'manual' && manualIds ? manualRows(base, manualIds) : base;
  const changes = changedRows(rows);
  const note = attendanceNote(preview.data?.attendance_records);

  const run = async () => {
    if (changes.length === 0) return;
    const ok = await confirm({ title: 'Apply new roll numbers?', message: renumberConfirmText(section.label, changes.length), confirmLabel: 'Apply' });
    if (!ok) return;
    setError(null);
    try {
      const res = await apply.mutateAsync({ id: section.id, data: applyPayload(order, manualIds) });
      toast.success(renumberResultText(res.data));
      onClose();
    } catch (e) { setError(renumberErrorText(e)); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Re-number ${section.label}`}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.hint}>Students on the roll are numbered 1, 2, 3 and so on in the order you choose. Students who have left keep their old number.</Text>
        <Select label="Order" value={order} options={RENUMBER_ORDERS} onChange={(v) => { setOrder(v as RenumberOrder); setError(null); }} />

        {preview.isLoading ? <Text style={styles.hint}>Building the preview…</Text> : null}
        {preview.isError ? <Text style={styles.err} accessibilityRole="alert">{renumberErrorText(preview.error)}</Text> : null}
        {order !== 'manual' && preview.data && changes.length === 0 ? <Text style={styles.hint}>Nothing would change: every student already has the number this order gives.</Text> : null}

        {order === 'manual' && manualIds ? rows.map((r, i) => (
          <View key={r.student_id} style={styles.row}>
            <Text style={styles.newRoll}>{r.new_roll}</Text>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.hint}>now {r.old_roll ?? '–'}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Move ${r.name} up`} disabled={i === 0} style={[styles.move, i === 0 && styles.off]} onPress={() => setManualIds((ids) => moveId(ids ?? [], i, -1))}>
              <Text style={styles.moveText}>↑</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Move ${r.name} down`} disabled={i === rows.length - 1} style={[styles.move, i === rows.length - 1 && styles.off]} onPress={() => setManualIds((ids) => moveId(ids ?? [], i, 1))}>
              <Text style={styles.moveText}>↓</Text>
            </TouchableOpacity>
          </View>
        )) : null}

        {order !== 'manual' ? changes.map((r) => (
          <View key={r.enrollment_id} style={styles.row}>
            <View style={styles.who}><Text style={styles.name} numberOfLines={1}>{r.name}</Text></View>
            <Text style={styles.old}>{r.old_roll ?? '–'}</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.newRoll}>{r.new_roll}</Text>
          </View>
        )) : null}

        {order !== 'manual' && preview.data && changes.length > 0 && (preview.data.unchanged ?? 0) > 0 ? <Text style={styles.hint}>{preview.data.unchanged} keep their number.</Text> : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {error ? <Text style={styles.err} accessibilityRole="alert">{error}</Text> : null}
        <Button title={changes.length > 0 ? `Apply new numbers (${changes.length})` : 'Apply new numbers'} onPress={run} loading={apply.isPending} disabled={apply.isPending || changes.length === 0} />
        <Button title="Close" variant="outline" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary },
  err: { fontSize: FontSize.sm, color: Colors.error },
  note: { fontSize: FontSize.sm, color: Colors.warningText, backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, minHeight: 44 },
  who: { flex: 1 },
  name: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },
  old: { fontSize: FontSize.sm, color: Colors.textSecondary },
  arrow: { fontSize: FontSize.sm, color: Colors.textTertiary },
  newRoll: { minWidth: 28, textAlign: 'right', fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  move: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  off: { opacity: 0.35 },
  moveText: { fontSize: 18, color: Colors.text },
});
