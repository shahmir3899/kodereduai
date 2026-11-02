import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { DAY_SHORT, shortTime, type EditDay, type Entry, type Slot } from '../../services/timetableEdit';
import { buildWeek, subjectColours, weekCounts, weekDays } from '../../services/timetableWeek';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TIME_W = 78;
const CELL_W = 112;

interface Props {
  slots: Slot[];
  entries: Entry[];
  // With this, tapping a lesson cell reports its day and period (the editor jumps there); without it the grid only shows.
  onCellPress?: (day: EditDay, slot: Slot) => void;
}

// The whole week at a glance, like the web's grid: periods down, days across, each lesson in its subject's colour. It
// scrolls sideways on a narrow phone. Section-only days are marked with a dot.
export default function WeekGrid({ slots, entries, onCellPress }: Props) {
  const rows = useMemo(() => buildWeek(slots, entries), [slots, entries]);
  const days = useMemo(() => weekDays(rows), [rows]);
  const colours = useMemo(() => subjectColours(entries), [entries]);
  const counts = useMemo(() => weekCounts(rows, days), [rows, days]);

  return (
    <View>
      <Text style={styles.sub}>{counts.filled} of {counts.total} periods filled this week</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
        <View>
          <View style={styles.row}>
            <View style={[styles.time, styles.head]}><Text style={styles.headText}>Period</Text></View>
            {days.map((d) => <View key={d} style={[styles.cellBox, styles.head]}><Text style={styles.headText}>{DAY_SHORT[d]}</Text></View>)}
          </View>
          {rows.map((r) => (
            <View key={r.slot.id} style={styles.row}>
              <View style={[styles.time, !r.lesson && styles.breakBox]}>
                <Text style={styles.slotName} numberOfLines={1}>{r.slot.name}</Text>
                <Text style={styles.slotTime}>{shortTime(r.slot.start_time)}-{shortTime(r.slot.end_time)}</Text>
              </View>
              {r.lesson ? days.map((d) => {
                const c = r.days[d];
                if (c === 'off') return <View key={d} style={[styles.cellBox, styles.off]} />;
                const colour = c && c.subjectId != null ? colours.get(c.subjectId) ?? Colors.primary : Colors.border;
                const press = onCellPress ? () => onCellPress(d, r.slot) : undefined;
                return (
                  <TouchableOpacity key={d} disabled={!press} accessibilityRole={press ? 'button' : undefined}
                    accessibilityLabel={`${DAY_SHORT[d]} ${r.slot.name}: ${c ? c.subject : 'empty'}`}
                    style={[styles.cellBox, c ? { borderLeftColor: colour, borderLeftWidth: 4, backgroundColor: Colors.surface } : styles.empty]} onPress={press}>
                    {c ? (
                      <>
                        <Text style={styles.subject} numberOfLines={2}>{c.override ? '• ' : ''}{c.subject}</Text>
                        {c.teacher ? <Text style={styles.teacher} numberOfLines={1}>{c.teacher}</Text> : null}
                        {c.room ? <Text style={styles.teacher} numberOfLines={1}>Room {c.room}</Text> : null}
                      </>
                    ) : <Text style={styles.dash}>–</Text>}
                  </TouchableOpacity>
                );
              }) : (
                <View style={[styles.breakBar, { width: CELL_W * days.length }]}><Text style={styles.breakText}>{r.slot.name}</Text></View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      {entries.some((e) => e.is_section_override) ? <Text style={styles.sub}>• marks a lesson that belongs to this section only.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.xs },
  row: { flexDirection: 'row' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xs },
  head: { backgroundColor: Colors.surfaceSecondary, minHeight: 32, justifyContent: 'center' },
  headText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  time: { width: TIME_W, padding: Spacing.xs, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, backgroundColor: Colors.surface },
  breakBox: { backgroundColor: Colors.surfaceSecondary },
  slotName: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.text },
  slotTime: { fontSize: 10, color: Colors.textSecondary },
  cellBox: { width: CELL_W, minHeight: 58, padding: Spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, justifyContent: 'center' },
  empty: { backgroundColor: Colors.background },
  off: { backgroundColor: Colors.surfaceSecondary, opacity: 0.5 },
  subject: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.text },
  teacher: { fontSize: 10, color: Colors.textSecondary },
  dash: { textAlign: 'center', color: Colors.textTertiary },
  breakBar: { backgroundColor: Colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center', borderRadius: BorderRadius.sm },
  breakText: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
