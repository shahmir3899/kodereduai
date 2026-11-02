import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View, StyleSheet } from 'react-native';
import { dayNumber, formatDay, type ManagedYear } from '../../services/academicSessions';
import {
  daysInYear, dateAtFraction, findGaps, findOverlaps, monthSpans, moveEdge, TERM_COLOURS, type Edge, type Span,
} from '../../services/yearTimeline';
import { Colors, FontSize, BorderRadius } from '../../constants/colors';

export interface TimelineTerm extends Span { id: number; name: string; order: number }

interface Props {
  year: Pick<ManagedYear, 'start_date' | 'end_date' | 'name'>;
  terms: TimelineTerm[];
  today?: string;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  // With this and a selected term, the term gets a drag handle on each edge: the bar itself is the slider.
  onRangeChange?: (range: Span) => void;
  compact?: boolean;
}

const HANDLE = 30;

// One academic year as a bar with its terms inside it: hatched-grey stretches are days no term covers,
// red-ringed terms overlap another, and a line marks today. Port of the web YearTimeline.
export default function YearTimeline({ year, terms, today, selectedId = null, onSelect, onRangeChange, compact = false }: Props) {
  const [width, setWidth] = useState(0);
  const total = daysInYear(year);
  const sorted = useMemo(() => [...terms].sort((a, b) => a.order - b.order), [terms]);
  const overlapping = useMemo(() => findOverlaps(sorted), [sorted]);
  const gaps = useMemo(() => findGaps(sorted, year.start_date, year.end_date), [sorted, year.start_date, year.end_date]);
  const months = useMemo(() => monthSpans(year.start_date, year.end_date), [year.start_date, year.end_date]);
  if (!(total > 0)) return null;

  const pct = (iso: string) => ((dayNumber(iso) - dayNumber(year.start_date)) / total) * 100;
  const place = (s: Span) => ({ left: `${pct(s.start_date)}%` as const, width: `${((dayNumber(s.end_date) - dayNumber(s.start_date) + 1) / total) * 100}%` as const });
  const selected = onRangeChange ? sorted.find((t) => t.id === selectedId) ?? null : null;
  const height = compact ? 12 : 56;
  const showToday = !!today && today >= year.start_date && today <= year.end_date;

  return (
    <View>
      {!compact ? (
        <View style={styles.months}>
          {months.map((m) => (
            <View key={m.key} style={{ position: 'absolute', left: `${pct(m.start_date)}%`, width: `${((dayNumber(m.end_date) - dayNumber(m.start_date) + 1) / total) * 100}%` }}>
              <Text style={styles.month} numberOfLines={1}>{m.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View
        style={[styles.bar, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`${year.name}: ${formatDay(year.start_date)} to ${formatDay(year.end_date)}, ${terms.length} terms`}
      >
        {!compact ? months.map((m, i) => (i % 2 === 0 ? <View key={m.key} style={[styles.monthBox, place(m)]} /> : null)) : null}
        {gaps.map((g) => <View key={g.start_date} style={[styles.gap, place(g)]} />)}
        {sorted.map((t, i) => {
          const ringed = overlapping.has(t.id);
          const isSel = t.id === selectedId;
          return (
            <View
              key={t.id} accessibilityRole={onSelect ? 'button' : undefined} accessibilityLabel={`${t.name}, ${formatDay(t.start_date)} to ${formatDay(t.end_date)}`}
              onStartShouldSetResponder={() => !!onSelect} onResponderRelease={() => onSelect?.(t.id)}
              style={[styles.term, place(t), { backgroundColor: TERM_COLOURS[i % TERM_COLOURS.length] }, isSel && styles.termSelected, ringed && styles.termRinged]}
            >
              {!compact ? <Text style={styles.termText} numberOfLines={1}>{t.name}</Text> : null}
            </View>
          );
        })}
        {showToday ? <View pointerEvents="none" style={[styles.today, { left: `${pct(today as string)}%` }]} /> : null}
      </View>
      {selected && width > 0 ? (
        <View style={{ height: HANDLE + 6 }} pointerEvents="box-none">
          <Handle edge="start" range={selected} year={year} width={width} onChange={onRangeChange as (r: Span) => void} />
          <Handle edge="end" range={selected} year={year} width={width} onChange={onRangeChange as (r: Span) => void} />
        </View>
      ) : null}
    </View>
  );
}

interface HandleProps {
  edge: Edge;
  range: Span;
  year: Pick<ManagedYear, 'start_date' | 'end_date'>;
  width: number;
  onChange: (r: Span) => void;
}

// One draggable edge. The pan follows the finger from where it grabbed, so the edge does not jump to it.
function Handle(props: HandleProps) {
  const latest = useRef(props);
  latest.current = props;
  const grabbed = useRef(0);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      const { edge, range, year, width } = latest.current;
      const total = daysInYear(year);
      const day = dayNumber(edge === 'start' ? range.start_date : range.end_date) - dayNumber(year.start_date) + (edge === 'start' ? 0 : 1);
      grabbed.current = (day / total) * width;
    },
    onPanResponderMove: (_e, g) => {
      const { edge, range, year, width, onChange } = latest.current;
      const iso = dateAtFraction((grabbed.current + g.dx) / width, year, edge);
      const next = moveEdge(range, edge, iso, year);
      if (next.start_date !== range.start_date || next.end_date !== range.end_date) onChange(next);
    },
  }), []);

  const { edge, range, year, width } = props;
  const total = daysInYear(year);
  const x = (((dayNumber(edge === 'start' ? range.start_date : range.end_date) - dayNumber(year.start_date)) + (edge === 'start' ? 0 : 1)) / total) * width;
  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="adjustable" accessibilityLabel={`${edge === 'start' ? 'Start' : 'End'} of the selected term, ${formatDay(edge === 'start' ? range.start_date : range.end_date)}`}
      style={[styles.handle, { left: x - HANDLE / 2 }]}
    >
      <View style={styles.grip} />
    </View>
  );
}

const styles = StyleSheet.create({
  months: { height: 16, marginBottom: 2 },
  month: { fontSize: FontSize.xs, color: Colors.textSecondary },
  bar: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, overflow: 'hidden' },
  monthBox: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(148,163,184,0.12)' },
  gap: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(148,163,184,0.45)' },
  term: { position: 'absolute', top: 2, bottom: 2, borderRadius: 4, justifyContent: 'center', paddingHorizontal: 6, opacity: 0.85 },
  termSelected: { opacity: 1, borderWidth: 2, borderColor: Colors.text },
  termRinged: { borderWidth: 2, borderColor: Colors.error },
  termText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '700' },
  today: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: Colors.error },
  handle: { position: 'absolute', top: 0, width: HANDLE, height: HANDLE + 6, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 14, height: HANDLE - 6, borderRadius: 7, backgroundColor: Colors.text, borderWidth: 2, borderColor: Colors.surface },
});
