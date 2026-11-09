import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { ATTENDANCE_STATUSES, CARD_KINDS, buildEdits, cellsFor, isEditable, money } from '../../services/assistantCards';
import type { Card } from '../../services/assistantState';
import type { CardNote } from '../../hooks/useAssistant';
import FeedbackThumbs from './FeedbackThumbs';

const VISIBLE_ROWS = 6;

function resultLine(result: any): string {
  if (!result) return 'Done';
  const parts = ['created', 'updated', 'saved', 'deleted']
    .filter((k) => typeof result[k] === 'number' && result[k] > 0)
    .map((k) => `${k} ${result[k]}`);
  if (typeof result.total_paid === 'number') parts.push(`Rs ${money(result.total_paid)}`);
  if (typeof result.total === 'number' && result.total) parts.push(`Rs ${money(result.total)}`);
  const failed = result.failed || (result.errors || []).length;
  return (parts.join(' · ') || 'Done') + (failed ? ` · ${failed} could not be saved` : '');
}

/**
 * A change Aura has prepared. Nothing is saved until Approve is tapped, and Approve is only ever a tap
 * on this card: never a voice command and never something the model can do.
 */
export default function ActionCard({ action, note, onApprove, onReject, onEdit }: {
  action: Card; note?: CardNote; onApprove: (id: number) => void; onReject: (id: number) => void; onEdit: (id: number, edits: object) => Promise<void> | void;
}) {
  const preview = action.preview || {};
  const kind: string = preview.kind;
  const cfg = CARD_KINDS[kind];
  const cells = useMemo(() => cellsFor(kind), [kind]);
  const columns: string[] = preview.columns || [];
  const rows: any[] = preview.rows || [];
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState({ removed: new Set<any>(), amounts: {} as Record<string, string>, statuses: {} as Record<string, string> });
  const busy = Boolean(note?.busy);
  const visible = showAll || editing ? rows : rows.slice(0, VISIBLE_ROWS);
  const assumptions = Object.entries(preview.assumptions || {}).filter(([, v]) => v !== '' && v != null);

  const startEdit = () => { setDraft({ removed: new Set(), amounts: {}, statuses: {} }); setEditing(true); };
  const toggleRemoved = (id: any) => setDraft((d) => {
    const removed = new Set(d.removed);
    if (removed.has(id)) removed.delete(id); else removed.add(id);
    return { ...d, removed };
  });
  const applyEdits = async () => {
    const edits = buildEdits(kind, rows, draft);
    if (Object.keys(edits).length) await onEdit(action.id, edits);
    setEditing(false);
  };

  const border = action.status === 'executed' ? Colors.success : action.status === 'failed' ? Colors.error : Colors.border;
  const chipOptions = cfg?.status?.options || ATTENDANCE_STATUSES;

  return (
    <View style={[styles.card, { borderColor: border }]}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{preview.title || 'Change'}</Text>
          {preview.summary ? <Text style={styles.summary}>{preview.summary}</Text> : null}
        </View>
        {action.status && action.status !== 'pending' && action.status !== 'edited' ? <Text style={styles.status}>{action.status}</Text> : null}
      </View>

      {assumptions.length > 0 && (
        <View style={styles.chips}>
          {assumptions.map(([k, v]) => (
            <Text key={k} style={styles.chip}>{k.replace(/_/g, ' ')}: {Array.isArray(v) ? v.join(', ') : String(v)}</Text>
          ))}
        </View>
      )}

      {visible.map((row) => {
        const id = row[cfg?.rowId ?? 'id'];
        const removed = draft.removed.has(id);
        return (
          <View key={String(id)} style={[styles.rowBox, removed && { opacity: 0.4 }]}>
            {cells.map(({ key, format }, i) => {
              const isAmount = editing && cfg?.amount?.key === key && !removed;
              const isStatus = editing && cfg?.status?.key === key;
              return (
                <View key={key} style={styles.cellLine}>
                  <Text style={styles.cellLabel}>{columns[i] ?? key}</Text>
                  {isAmount ? (
                    <TextInput
                      style={styles.input} keyboardType="numeric" defaultValue={String(row[key] ?? '')}
                      accessibilityLabel={`${columns[i] ?? key} for ${row.student || row.description || id}`}
                      onChangeText={(v) => setDraft((d) => ({ ...d, amounts: { ...d.amounts, [id]: v } }))}
                    />
                  ) : isStatus ? (
                    <View style={styles.chips}>
                      {chipOptions.map((s) => {
                        const on = (draft.statuses[id] ?? row[key]) === s;
                        return (
                          <Pressable key={s} accessibilityRole="button" accessibilityLabel={`Set ${row.student || row.staff} to ${s}`} accessibilityState={{ selected: on }}
                            onPress={() => setDraft((d) => ({ ...d, statuses: { ...d.statuses, [id]: s } }))} style={[styles.pick, on && styles.pickOn]}>
                            <Text style={[styles.pickText, on && { color: Colors.textInverse }]}>{s}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={[styles.cellValue, key === 'status' && row[key] === 'ABSENT' && { color: Colors.errorText, fontWeight: '700' }]}>{format(row[key], row)}</Text>
                  )}
                </View>
              );
            })}
            {editing && cfg?.removeAs && (
              <Pressable accessibilityRole="button" accessibilityLabel={removed ? `Keep row ${id}` : `Remove row ${id}`} onPress={() => toggleRemoved(id)} hitSlop={6}>
                <Text style={styles.link}>{removed ? 'Keep this row' : 'Remove this row'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {rows.length > VISIBLE_ROWS && !editing && (
        <Pressable accessibilityRole="button" accessibilityLabel={showAll ? 'Show fewer rows' : `Show all ${rows.length} rows`} onPress={() => setShowAll((v) => !v)} hitSlop={6}>
          <Text style={styles.link}>{showAll ? 'Show fewer' : `Show all ${rows.length}`}</Text>
        </Pressable>
      )}

      {preview.totals && (preview.totals.paying !== undefined || preview.totals.amount !== undefined) ? (
        <Text style={styles.total}>Total Rs {money(preview.totals.paying ?? preview.totals.amount)}</Text>
      ) : null}
      {preview.account ? (
        <Text style={styles.summary}>{preview.account.name}: Rs {money(preview.account.balance_before)} → Rs {money(preview.account.balance_after)} (estimate)</Text>
      ) : null}
      {(preview.warnings || []).map((w: string) => <Text key={w} style={styles.warn}>{w}</Text>)}
      {editing && cfg?.note ? <Text style={styles.summary}>{cfg.note}</Text> : null}
      {note?.error ? <Text accessibilityRole="alert" style={styles.err}>{note.error}</Text> : null}
      {action.status === 'failed' && action.error ? <Text style={styles.err}>{action.error}</Text> : null}
      {action.status === 'executed' ? <Text style={styles.ok}>{resultLine(action.result)}</Text> : null}
      {(action.status === 'executed' || action.status === 'rejected') && <FeedbackThumbs messageId={action.message_id} label="Was this card right?" />}
      {action.status === 'expired' ? <Text style={styles.summary}>This card expired. Ask again to prepare it.</Text> : null}

      {action.can_act && (
        <View style={styles.buttons}>
          {editing ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Update card" disabled={busy} onPress={applyEdits} style={[styles.btn, styles.btnDark, busy && styles.off]}><Text style={styles.btnDarkText}>Update card</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" disabled={busy} onPress={() => setEditing(false)} style={styles.btn}><Text style={styles.btnText}>Cancel</Text></Pressable>
            </>
          ) : (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Approve" disabled={busy} onPress={() => onApprove(action.id)} style={[styles.btn, styles.btnDark, busy && styles.off]}><Text style={styles.btnDarkText}>{busy ? 'Working…' : 'Approve'}</Text></Pressable>
              {isEditable(kind) && <Pressable accessibilityRole="button" accessibilityLabel="Edit" disabled={busy} onPress={startEdit} style={[styles.btn, busy && styles.off]}><Text style={styles.btnText}>Edit</Text></Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel="Reject" disabled={busy} onPress={() => onReject(action.id)} style={[styles.btn, busy && styles.off]}><Text style={styles.btnText}>Reject</Text></Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: Spacing.sm, borderWidth: 1, borderRadius: BorderRadius.lg, backgroundColor: Colors.surface, padding: Spacing.md },
  head: { flexDirection: 'row', gap: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  summary: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  status: { fontSize: FontSize.xs, color: Colors.neutralText, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2, alignSelf: 'flex-start', textTransform: 'capitalize', overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  chip: { fontSize: FontSize.xs, color: Colors.neutralText, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2, overflow: 'hidden' },
  rowBox: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  cellLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 1, alignItems: 'center' },
  cellLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'capitalize' },
  cellValue: { flex: 1, textAlign: 'right', fontSize: FontSize.sm, color: Colors.text },
  input: { minWidth: 90, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 4, textAlign: 'right', color: Colors.text },
  pick: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  pickOn: { backgroundColor: Colors.text, borderColor: Colors.text },
  pickText: { fontSize: FontSize.xs, color: Colors.text },
  link: { fontSize: FontSize.xs, color: Colors.primary, marginTop: Spacing.xs, textDecorationLine: 'underline' },
  total: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  warn: { fontSize: FontSize.xs, color: Colors.warningText, marginTop: Spacing.xs },
  err: { fontSize: FontSize.xs, color: Colors.errorText, marginTop: Spacing.sm },
  ok: { fontSize: FontSize.xs, color: Colors.successText, marginTop: Spacing.sm },
  buttons: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  btn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, minHeight: 44, justifyContent: 'center' },
  btnDark: { backgroundColor: Colors.text, borderColor: Colors.text },
  btnText: { fontSize: FontSize.sm, color: Colors.text },
  btnDarkText: { fontSize: FontSize.sm, color: Colors.textInverse, fontWeight: '600' },
  off: { opacity: 0.5 },
});
