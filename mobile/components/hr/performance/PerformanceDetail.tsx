import React, { useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Card from '../../ui/Card';
import StatusPill from '../../ui/StatusPill';
import PerformanceInfoButton from './PerformanceInfoButton';
import {
  bandTone, describeMissed, formatScore, infoRows, orderedMeasures, positionText, scoreLevel,
  type Measure, type TeacherResponse,
} from '../../../services/teacherPerformance';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';
import { day } from '../../../services/dates';

const BAR = { good: Colors.success, mid: Colors.warning, low: Colors.error };

function MeasureCard({ m }: { m: Measure }) {
  const [showMissed, setShowMissed] = useState(false);
  if (!m.applicable) {
    return (
      <View style={styles.na}>
        <Text style={styles.naText}>{m.label} — does not apply in this period</Text>
      </View>
    );
  }
  const missed = m.missed ?? [];
  return (
    <Card style={styles.measure}>
      <View style={styles.rowBetween}>
        <View style={styles.rowGap}>
          <Text style={styles.measureTitle}>{m.label}</Text>
          <PerformanceInfoButton measure={m.key} label={`How ${m.label} is scored`} />
        </View>
        <Text style={styles.measureScore}>{formatScore(m.score)}</Text>
      </View>
      <View style={styles.track} accessibilityLabel={`${m.label} score ${formatScore(m.score)} out of 100`}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, m.score ?? 0))}%`, backgroundColor: BAR[scoreLevel(m.score)] }]} />
      </View>
      <Text style={styles.small}>Due {m.due} · Done {m.done} · On time {m.on_time} · Weight {m.effective_weight}%</Text>
      {missed.length > 0 && (
        <>
          <TouchableOpacity onPress={() => setShowMissed((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showMissed }}>
            <Text style={styles.link}>
              {showMissed ? 'Hide' : 'Show'} {missed.length >= 30 ? '30+' : missed.length} item{missed.length === 1 ? '' : 's'} to fix
            </Text>
          </TouchableOpacity>
          {showMissed && missed.map((item, i) => <Text key={i} style={styles.small}>{describeMissed(item)}</Text>)}
        </>
      )}
    </Card>
  );
}

// One teacher's breakdown, for the teacher's own screen and the admin detail.
export default function PerformanceDetail({ data }: { data: TeacherResponse }) {
  const t = data.teacher;
  const position = positionText(t.rank, data.out_of);
  const info = infoRows(t.info);
  return (
    <View style={styles.gap}>
      <Card>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{t.name}</Text>
            <Text style={styles.small}>
              {data.period.start} to {data.period.end}
              {data.period.counted_until !== data.period.end ? ` (counted until ${data.period.counted_until})` : ''}
            </Text>
            {data.snapshot && data.frozen_at ? (
              <Text style={styles.small}>Frozen on {day(data.frozen_at)}</Text>
            ) : null}
          </View>
          <View style={styles.scoreBox}>
            <View style={styles.rowGap}>
              <Text style={styles.score}>{formatScore(t.overall_score)}</Text>
              <PerformanceInfoButton wins={t.quickest_wins} />
            </View>
            {t.band ? <StatusPill label={t.band.label} tone={bandTone(t.band)} /> : null}
            {position ? <Text style={styles.small}>{position}</Text> : null}
          </View>
        </View>
      </Card>
      {orderedMeasures(t.measures).map((m) => <MeasureCard key={m.key} m={m} />)}
      {info.length > 0 && (
        <View style={styles.info}>
          <Text style={styles.measureTitle}>For information, not scored</Text>
          {info.map((r) => (
            <View key={r.label} style={styles.rowBetween}>
              <Text style={styles.small}>{r.label}</Text>
              <Text style={styles.infoValue}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.md },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  scoreBox: { alignItems: 'flex-end', gap: Spacing.xs },
  score: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.text },
  measure: { gap: Spacing.xs },
  measureTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  measureScore: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  track: { height: 8, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 8, borderRadius: BorderRadius.full },
  small: { fontSize: FontSize.xs, color: Colors.textSecondary },
  link: { fontSize: FontSize.sm, color: Colors.primary, marginTop: Spacing.xs },
  na: { borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md },
  naText: { fontSize: FontSize.sm, color: Colors.textTertiary },
  info: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs },
  infoValue: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
});
