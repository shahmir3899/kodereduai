import React, { useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { academicsApi } from '../../services/api';
import { inventoryErrorMessage } from '../../services/inventory';
import {
  conflictLine, hasSuggestions, resolutionView, scoreParts, scoreTone, slotLine, strongSubstitute, substituteView, validateSubstitute,
  type ConflictData, type QualityData, type ResolutionData, type SubstituteData,
} from '../../services/timetableWeek';
import { schoolToday } from '../../services/schoolTime';
import Button from '../ui/Button';
import DateField from '../ui/DateField';
import Select from '../ui/Select';
import StatusPill from '../ui/StatusPill';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The quality score as a small badge; tapping it opens the breakdown.
export function ScoreBadge({ score, onPress }: { score: QualityData; onPress: () => void }) {
  const v = Math.round(Number(score.overall_score) || 0);
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Timetable quality score ${v} out of 100`} onPress={onPress}>
      <StatusPill label={`Quality ${v}/100`} tone={scoreTone(v)} />
    </TouchableOpacity>
  );
}

export function ScoreSheet({ visible, onClose, score }: { visible: boolean; onClose: () => void; score: QualityData | null }) {
  const overall = Math.round(Number(score?.overall_score) || 0);
  return (
    <FormSheet visible={visible && !!score} title="Timetable quality score" onClose={onClose} onSubmit={onClose} submitLabel="Close">
      <View style={styles.center}>
        <Text style={[styles.big, { color: toneColour(scoreTone(overall)) }]}>{overall}</Text>
        <Text style={styles.sub}>out of 100</Text>
      </View>
      {score ? scoreParts(score).map((p) => (
        <View key={p.label} style={styles.part}>
          <View style={styles.partHead}>
            <Text style={styles.sub}>{p.label}</Text>
            <Text style={styles.name}>{p.value} <Text style={styles.sub}>({p.weight})</Text></Text>
          </View>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, p.value)}%`, backgroundColor: toneColour(p.tone) }]} /></View>
        </View>
      )) : null}
    </FormSheet>
  );
}

const toneColour = (t: 'success' | 'warning' | 'error') => (t === 'success' ? Colors.success : t === 'warning' ? Colors.warning : Colors.error);

// Shown in the period sheet when the chosen teacher is already teaching another class then. The suggestions come from the
// server (other teachers free at that time, other free periods for this teacher, swaps).
export function ClashNotice({ conflict, params, onPickTeacher }: {
  conflict: ConflictData | null;
  // What the server needs to suggest alternatives: teacher, day, slot, class and subject.
  params: Record<string, unknown>;
  onPickTeacher: (id: number, name: string) => void;
}) {
  const [data, setData] = useState<ResolutionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const line = conflictLine(conflict);
  if (!line) return null;
  const view = resolutionView(data);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      setData((await academicsApi.suggestConflictResolution(params)).data as ResolutionData);
    } catch {
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.warn} accessibilityRole="alert">
      <Text style={styles.warnText}>{line}</Text>
      <Button title={loading ? 'Looking…' : 'Suggest alternatives'} size="sm" variant="outline" onPress={load} disabled={loading} />
      {failed ? <Text style={styles.warnText}>Could not load suggestions.</Text> : null}
      {data && !hasSuggestions(view) ? <Text style={styles.warnText}>No alternatives found.</Text> : null}
      {view.teachers.length > 0 ? (
        <View style={styles.gap}>
          <Text style={styles.name}>Available teachers</Text>
          {view.teachers.map((t) => (
            <TouchableOpacity key={t.teacher_id} accessibilityRole="button" accessibilityLabel={`Use ${t.teacher_name}`} style={styles.pick} onPress={() => onPickTeacher(t.teacher_id, t.teacher_name)}>
              <Text style={styles.name}>{t.teacher_name}{t.qualification_match && t.qualification_match > 0 && t.reason ? ` (${t.reason})` : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {view.slots.length > 0 ? (
        <View style={styles.gap}>
          <Text style={styles.name}>Free periods for this teacher</Text>
          <Text style={styles.sub}>{view.slots.map(slotLine).join('  ·  ')}</Text>
        </View>
      ) : null}
      {view.swaps.length > 0 ? (
        <View style={styles.gap}>
          <Text style={styles.name}>Swap options</Text>
          {view.swaps.map((s, i) => <Text key={i} style={styles.sub}>{s.reason}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

// Who could cover a teacher's lessons on a date: the server lists the lessons and the free teachers for each.
export function SubstituteSheet({ visible, onClose, teachers }: { visible: boolean; onClose: () => void; teachers: Array<{ value: number; label: string }> }) {
  const [teacher, setTeacher] = useState<number | null>(null);
  const [date, setDate] = useState(schoolToday());
  const [data, setData] = useState<SubstituteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async () => {
    const problem = validateSubstitute(teacher, date);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      setData((await academicsApi.suggestSubstitute({ teacher, date })).data as SubstituteData);
    } catch (e) {
      setData(null);
      setError(inventoryErrorMessage(e, 'Failed to find substitutes.'));
    } finally {
      setBusy(false);
    }
  };

  const view = substituteView(data);
  return (
    <FormSheet visible={visible} title="Find a substitute" onClose={onClose} onSubmit={find} submitLabel="Find substitutes" busy={busy} error={error ?? view.error}>
      <Select label="Teacher who is away" searchable value={teacher} onChange={(v) => { setTeacher(Number(v)); setData(null); }} placeholder="Choose a teacher" options={teachers} />
      <DateField label="Date" value={date} onChange={(v) => { setDate(v); setData(null); }} />
      {data && !view.error ? (
        <View style={styles.gap}>
          <Text style={styles.sub}>{view.heading}</Text>
          {view.entries.length === 0 ? <Text style={styles.sub}>No classes need cover.</Text> : view.entries.map((e, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.name}>{e.slot_name} ({e.slot_start}-{e.slot_end})</Text>
              <Text style={styles.sub}>{[e.class_name, e.subject_name].filter(Boolean).join(' — ')}</Text>
              {(e.suggested_substitutes ?? []).length > 0 ? (e.suggested_substitutes ?? []).map((s, j) => (
                <View key={j} style={styles.sub2}>
                  <Text style={styles.name}>{s.teacher_name}</Text>
                  <StatusPill label={s.reason || 'Available'} tone={strongSubstitute(s.score) ? 'success' : 'neutral'} />
                </View>
              )) : <Text style={styles.sub}>No substitutes available for this period.</Text>}
            </View>
          ))}
        </View>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  big: { fontSize: 40, fontWeight: '700' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  part: { gap: 4 },
  partHead: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 6 },
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.sm, padding: Spacing.md, gap: Spacing.xs },
  warnText: { fontSize: FontSize.sm, color: Colors.warningText },
  gap: { gap: Spacing.xs },
  pick: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.sm },
  card: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 4 },
  sub2: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
});
