import React, { useState } from 'react';
import { View, Text, ScrollView, Linking, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useRouter } from 'expo-router';
import { useAdmissionsActions, useEnquiry } from '../../hooks/useAdmissions';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  admissionsErrorMessage, buildNotePayload, canCancel, canConfirm, canConvert, canDeleteCancelled, canEdit, formatDay, formatStamp,
  gradeLabel, NOTE_TYPES, noteTypeLabel, sourceLabel, statusLabel, statusTone, telUrl, validateNote, type EnquiryDetail,
} from '../../services/admissions';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import StatusPill from '../ui/StatusPill';
import SegmentedTabs from '../ui/SegmentedTabs';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import EnquiryFormSheet from './EnquiryFormSheet';
import ConvertSheet from './ConvertSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// One enquiry: its details, the activity timeline, notes and call logs, and the status actions.
export default function EnquiryDetailScreen({ id }: { id: number }) {
  const router = useRouter();
  const toast = useToast();
  const actions = useAdmissionsActions();
  const query = useEnquiry(id);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [noteType, setNoteType] = useState<'NOTE' | 'CALL'>('NOTE');
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  if (query.isLoading) return <Skeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const e: EnquiryDetail = query.data;

  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(admissionsErrorMessage(err));
      return false;
    }
  };

  const call = () => {
    const url = telUrl(e.mobile);
    if (url) Linking.openURL(url).catch(() => toast.error('Could not open the phone app.'));
  };

  const addNote = async () => {
    const problem = validateNote(noteText);
    if (problem) {
      setNoteError(problem);
      return;
    }
    setNoteError(null);
    const ok = await run(() => actions.addNote.mutateAsync({ id: e.id, data: buildNotePayload(noteText, noteType) }), 'Note added.');
    if (ok) setNoteText('');
  };

  // Deleting (cancelling) an enquiry removes its notes too, and cannot be undone.
  const remove = async (cancel: boolean) => {
    const ok = await confirm({
      title: cancel ? 'Cancel enquiry' : 'Delete enquiry',
      message: cancel ? `Cancel the enquiry for ${e.name}? It is deleted for good, with its notes.` : `Delete the enquiry for ${e.name}?`,
      confirmLabel: cancel ? 'Cancel enquiry' : 'Delete', cancelLabel: 'Keep it', destructive: true,
    });
    if (ok && (await run(() => actions.deleteEnquiry.mutateAsync(e.id), 'Enquiry deleted.'))) router.back();
  };

  const rows: Array<[string, string]> = [
    ['Father', e.father_name],
    ['Mobile', e.mobile],
    ['Grade', gradeLabel(e.applying_for_grade_level)],
    ['Source', e.source_display ?? sourceLabel(e.source)],
    ['Next follow-up', formatDay(e.next_followup_date)],
    ['Enquired on', formatDay(e.created_at)],
  ];

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.title}>{e.name}</Text>
          <StatusPill label={e.status_display ?? statusLabel(e.status)} tone={statusTone(e.status)} />
        </View>
        {rows.map(([k, v]) => (
          <View key={k} style={styles.kv}><Text style={styles.key}>{k}</Text><Text style={styles.val}>{v}</Text></View>
        ))}
        {e.notes ? <Text style={styles.notes}>{e.notes}</Text> : null}
        {e.converted_student ? (
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel={`Open student ${e.converted_student_name ?? ''}`}
            onPress={() => router.push({ pathname: '/(admin)/students/[id]', params: { id: String(e.converted_student) } })}
          >
            <Text style={styles.link}>Student: {e.converted_student_name ?? `#${e.converted_student}`} →</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.buttons}>
        {telUrl(e.mobile) ? <Button title="Call" variant="outline" size="sm" onPress={call} /> : null}
        {canConfirm(e) ? <Button title="Confirm" size="sm" onPress={() => run(() => actions.setStatus.mutateAsync({ id: e.id, status: 'CONFIRMED' }), 'Enquiry confirmed.')} /> : null}
        {canConvert(e) ? <Button title="Convert to student" size="sm" onPress={() => setConverting(true)} /> : null}
        {canEdit(e) ? <Button title="Edit" variant="outline" size="sm" onPress={() => setEditing(true)} /> : null}
        {canCancel(e) ? <Button title="Cancel enquiry" variant="danger" size="sm" onPress={() => remove(true)} /> : null}
        {canDeleteCancelled(e) ? <Button title="Delete" variant="danger" size="sm" onPress={() => remove(false)} /> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add to the timeline</Text>
        <SegmentedTabs tabs={NOTE_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={noteType} onChange={setNoteType} />
        <Input
          value={noteText} onChangeText={setNoteText} multiline numberOfLines={3} error={noteError ?? undefined}
          placeholder={noteType === 'CALL' ? 'What was said on the call?' : 'Write a note...'} style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
        <Button title={noteType === 'CALL' ? 'Log call' : 'Add note'} size="sm" onPress={addNote} loading={actions.addNote.isPending} disabled={actions.addNote.isPending} />
      </View>

      <Text style={styles.section}>Timeline</Text>
      {e.notes_list.length === 0 ? <Text style={styles.empty}>Nothing logged yet.</Text> : null}
      {e.notes_list.map((n) => (
        <View key={n.id} style={styles.note}>
          <Text style={styles.noteMeta}>{noteTypeLabel(n.note_type)}{n.user_name ? ` · ${n.user_name}` : ''} · {formatStamp(n.created_at)}</Text>
          <Text style={styles.noteText}>{n.note}</Text>
        </View>
      ))}

      <EnquiryFormSheet visible={editing} enquiry={e} onClose={() => setEditing(false)} />
      <ConvertSheet
        visible={converting} enquiries={[e]} onClose={() => setConverting(false)}
        onDone={(summary) => {
          setConverting(false);
          if (summary.allFailed) toast.error(summary.failures[0] ?? summary.message);
          else toast.success(summary.message);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  key: { fontSize: FontSize.sm, color: Colors.textSecondary },
  val: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  notes: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.xs },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', minHeight: 36, textAlignVertical: 'center' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  empty: { fontSize: FontSize.sm, color: Colors.textSecondary },
  note: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 2 },
  noteMeta: { fontSize: FontSize.xs, color: Colors.textSecondary },
  noteText: { fontSize: FontSize.sm, color: Colors.text },
});
