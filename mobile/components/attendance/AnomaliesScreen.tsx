import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAnomalies, useResolveAnomaly } from '../../hooks/useAnomalies';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  STATE_FILTERS, TYPE_FILTERS, anomalySubject, anomalyTitle, resolveErrorMessage, resolvedLine, severityLabel, severityTone,
  type Anomaly, type StateFilter,
} from '../../services/anomalies';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Unusual attendance patterns the server finds each day. Review one and resolve it with a note.
// Admin and principal only.
export default function AnomaliesScreen() {
  const toast = useToast();
  const [state, setState] = useState<StateFilter>('open');
  const [type, setType] = useState('');
  const q = useAnomalies(state, type);
  const resolve = useResolveAnomaly();
  const refreshControl = useRefreshControl(q.refetch);
  const [target, setTarget] = useState<Anomaly | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (a: Anomaly) => { setTarget(a); setNotes(''); setError(null); };

  const submit = async () => {
    if (!target) return;
    setError(null);
    try {
      await resolve.mutateAsync({ id: target.id, notes });
      toast.success('Marked as resolved.');
      setTarget(null);
    } catch (e) { setError(resolveErrorMessage(e)); }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <SegmentedTabs<StateFilter> tabs={STATE_FILTERS} value={state} onChange={setState} />
        <Select label="Type" value={type} options={TYPE_FILTERS} onChange={(v) => setType(String(v))} />
        <QueryBoundary query={q} emptyTitle={state === 'open' ? 'Nothing to review' : 'Nothing resolved yet'}
          emptyMessage={state === 'open' ? 'No unusual attendance patterns are waiting.' : 'Resolved items appear here.'}>
          {(list) => list.map((a) => (
            <Card key={a.id} style={styles.card}>
              <View style={styles.top}>
                <View style={styles.who}>
                  <Text style={styles.title}>{anomalyTitle(a)}</Text>
                  <Text style={styles.sub}>{a.date}{anomalySubject(a) ? `  ·  ${anomalySubject(a)}` : ''}</Text>
                </View>
                <StatusPill label={severityLabel(a.severity)} tone={severityTone(a.severity)} />
              </View>
              <Text style={styles.desc}>{a.description}</Text>
              {a.is_resolved ? <Text style={styles.resolved}>{resolvedLine(a)}</Text> : (
                <Button title="Resolve" size="sm" variant="outline" onPress={() => open(a)} style={styles.btn} />
              )}
            </Card>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={target !== null} title="Resolve" onClose={() => setTarget(null)} onSubmit={submit} submitLabel="Mark as resolved" busy={resolve.isPending} error={error}>
        {target ? <Text style={styles.desc}>{anomalyTitle(target)}: {target.description}</Text> : null}
        <Input label="Note (optional)" value={notes} onChangeText={setNotes} placeholder="What was the reason?" multiline style={styles.area} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card: { marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  who: { flex: 1 },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  desc: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.sm },
  resolved: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.sm },
  btn: { alignSelf: 'flex-start', marginTop: Spacing.sm },
  area: { minHeight: 72, textAlignVertical: 'top' },
});
