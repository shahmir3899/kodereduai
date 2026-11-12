import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSchoolUsers } from '../../hooks/useSchoolUsers';
import { useActiveTemplates, useSendNotification } from '../../hooks/useNotificationSend';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import {
  AUDIENCES, CHANNELS, EVENT_TYPES, applyTemplate, audienceHasSections, broadcastResultText, buildBroadcastPayload,
  buildPreviewPayload, buildSinglePayload, composePlaceholders, emptyCompose, previewLine, sendErrorMessage, validateCompose,
  type ComposeForm, type Mode, type RecipientPreview,
} from '../../services/notificationSend';
import { roleLabel } from '../../services/schoolUsers';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ALL_SECTIONS = 0;

// Send a message to a whole group (parents, teachers and so on, optionally one section) or to one
// person, on in-app, push or email. A group send shows who would receive it and asks before it goes.
export default function SendNotificationScreen() {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('broadcast');
  const [form, setForm] = useState<ComposeForm>(emptyCompose());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<RecipientPreview | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const send = useSendNotification();
  const templates = useActiveTemplates();
  const users = useSchoolUsers();
  const { options: sections } = useAttendanceClassOptions();

  const set = <K extends keyof ComposeForm>(k: K, v: ComposeForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setPreview(null); };
  const placeholders = composePlaceholders(form);
  const busy = send.preview.isPending || send.broadcast.isPending || send.single.isPending;

  const pickUser = (id: number) => {
    const u = (users.data ?? []).find((x) => x.id === id);
    setForm((f) => ({ ...f, recipientId: id, recipientRole: u?.role ?? '' }));
  };

  // Validate, then (for a group) ask the server who would get it, then show the confirm sheet.
  const review = async () => {
    const problem = validateCompose(form, mode);
    setError(problem);
    if (problem) return;
    setSheetError(null);
    if (mode === 'single') { setPreview(null); setConfirming(true); return; }
    try {
      setPreview(await send.preview.mutateAsync(buildPreviewPayload(form)));
      setConfirming(true);
    } catch (e) { setError(sendErrorMessage(e, 'Could not check who would receive this.')); }
  };

  const reset = () => { setForm(emptyCompose()); setPreview(null); setError(null); };

  const confirmSend = async () => {
    setSheetError(null);
    try {
      if (mode === 'broadcast') {
        const result = await send.broadcast.mutateAsync(buildBroadcastPayload(form));
        toast.success(broadcastResultText(result));
      } else {
        const result = await send.single.mutateAsync(buildSinglePayload(form));
        if (result.skipped) toast.error(result.detail || 'Skipped: the channel is off or the person opted out.');
        else toast.success('Notification sent.');
      }
      setConfirming(false);
      reset();
    } catch (e) { setSheetError(sendErrorMessage(e, 'Could not send the notification.')); }
  };

  const userName = (u: { first_name?: string | null; last_name?: string | null; username: string }) =>
    [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;

  const who = mode === 'single'
    ? (users.data ?? []).filter((u) => u.id === form.recipientId).map(userName)[0] ?? 'the chosen person'
    : AUDIENCES.find((a) => a.value === form.audience)?.label.toLowerCase() ?? 'the group';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SegmentedTabs<Mode> value={mode} onChange={(m) => { setMode(m); setPreview(null); setError(null); }}
          tabs={[{ value: 'broadcast', label: 'To a group' }, { value: 'single', label: 'To one person' }]} />

        {(templates.data ?? []).length > 0 ? (
          <Select label="Start from a template (optional)" value={null} placeholder="Choose a template" searchable
            options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            onChange={(id) => { const t = (templates.data ?? []).find((x) => x.id === id); if (t) { setForm((f) => applyTemplate(f, t)); setPreview(null); } }} />
        ) : null}

        {mode === 'broadcast' ? (
          <>
            <Select label="Send to" value={form.audience} options={AUDIENCES} onChange={(v) => { set('audience', String(v)); set('placement', null); }} />
            {audienceHasSections(form.audience) ? (
              <Select label="Section (optional)" value={form.placement?.id ?? ALL_SECTIONS} searchable
                options={[{ value: ALL_SECTIONS, label: 'Everyone' }, ...sections.map((s) => ({ value: s.id, label: s.label }))]}
                onChange={(id) => set('placement', id === ALL_SECTIONS ? null : sections.find((s) => s.id === id) ?? null)} />
            ) : null}
          </>
        ) : (
          <Select label="Send to" value={form.recipientId} searchable placeholder={users.isLoading ? 'Loading people...' : 'Choose a person'}
            options={(users.data ?? []).filter((u) => u.is_active).map((u) => ({ value: u.id, label: `${userName(u)}  (${roleLabel(u.role)})` }))}
            onChange={pickUser} />
        )}

        <Select label="Type" value={form.eventType} options={EVENT_TYPES} onChange={(v) => set('eventType', String(v))} />
        <Select label="Channel" value={form.channel} options={CHANNELS} onChange={(v) => set('channel', String(v))} />
        <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} placeholder="Notification title" maxLength={200} />
        <Input label="Message" value={form.body} onChangeText={(v) => set('body', v)} placeholder="Type your message here..." multiline style={styles.area} />

        {placeholders.length > 0 ? (
          <Text style={styles.warn}>This text still has placeholders ({placeholders.map((p) => `{{${p}}}`).join(', ')}). They are not filled in for a manual message; replace them with real text.</Text>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <Button title={mode === 'broadcast' ? 'Review and send' : 'Send'} onPress={review} loading={busy && !confirming} disabled={busy} fullWidth size="lg" />
      </ScrollView>

      <FormSheet visible={confirming} title="Send this notification?" onClose={() => setConfirming(false)} onSubmit={confirmSend} submitLabel="Send now"
        busy={send.broadcast.isPending || send.single.isPending} error={sheetError}>
        <Text style={styles.sheetTitle}>{form.title.trim()}</Text>
        <Text style={styles.sheetBody} numberOfLines={6}>{form.body.trim()}</Text>
        <Text style={styles.sheetLine}>
          To {who} by {CHANNELS.find((c) => c.value === form.channel)?.label.toLowerCase()}.
        </Text>
        {mode === 'broadcast' && preview ? <Text style={styles.sheetCount}>{previewLine(preview)}</Text> : null}
        {placeholders.length > 0 ? <Text style={styles.warn}>It still contains {placeholders.map((p) => `{{${p}}}`).join(', ')}.</Text> : null}
      </FormSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.xs },
  area: { minHeight: 96, textAlignVertical: 'top' },
  warn: { color: Colors.warning, fontSize: FontSize.sm, backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginVertical: Spacing.sm },
  error: { color: Colors.error, fontSize: FontSize.sm, marginVertical: Spacing.sm },
  sheetTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sheetBody: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  sheetLine: { fontSize: FontSize.sm, color: Colors.text },
  sheetCount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary, marginVertical: Spacing.sm },
});
