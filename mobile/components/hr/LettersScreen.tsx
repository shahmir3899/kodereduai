import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { lettersApi } from '../../services/api';
import { useLetterActions, useLetters, useLetterTemplates } from '../../hooks/useLetters';
import { useStaffOptions } from '../../hooks/usePayroll';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { applyTemplate, buildLetterPayload, buildPdfPayload, emptyLetterForm, hasText, LINE_SPACINGS, letterFileName, letterToForm,
  validateLetter, type Letter, type LetterForm, AI_PROMPT_MAX, aiDraftDone, aiDraftEmpty, aiErrorText, applyAiDraft, buildAiPayload, validateAiPrompt, type AiDraftReply, type AiStaff,
} from '../../services/letters';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import { inventoryErrorMessage } from '../../services/inventory';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of the Letter Composer for admin and principal: pick a template, fill it for a staff member,
// save it, and share the server-made PDF (identical to the web's). "Draft with AI" writes the subject and
// body from a description.
export default function LettersScreen() {
  const toast = useToast();
  const actions = useLetterActions();
  const q = useLetters();
  const templates = useLetterTemplates();
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  const [editing, setEditing] = useState<Letter | 'new' | null>(null);
  const staff = useStaffOptions(editing !== null);
  const [form, setForm] = useState<LetterForm>(emptyLetterForm());
  const [employee, setEmployee] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const set = <K extends keyof LetterForm>(k: K, v: LetterForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pickTemplate = async (key: string) => {
    if (hasText(form) && !(await confirm({ title: 'Replace the text?', message: 'Choosing a template replaces the subject and body.', confirmLabel: 'Replace' }))) return;
    setForm(applyTemplate(form, key, templates.data ?? {}));
    setEmployee(null);
  };

  // Fills {employee_name}, {designation} and the like from the staff record (server does the merge).
  const fillFromStaff = async (id: number) => {
    setEmployee(id);
    setBusy('prefill');
    try {
      const body = (await actions.prefill.mutateAsync({ template_body: form.body, employee_id: id })).data as { prefilled_body?: string };
      const subject = (await actions.prefill.mutateAsync({ template_body: form.subject, employee_id: id })).data as { prefilled_body?: string };
      setForm((f) => ({ ...f, body: body.prefilled_body ?? f.body, subject: subject.prefilled_body ?? f.subject }));
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not fill from the staff record.'));
    } finally {
      setBusy(null);
    }
  };

  const openDraft = () => { setAiPrompt(''); setAiError(null); setDrafting(true); };

  const draft = async () => {
    const problem = validateAiPrompt(aiPrompt);
    if (problem) return setAiError(problem);
    if (hasText(form) && !(await confirm({ title: 'Replace the text?', message: 'The drafted subject and body replace what is written now.', confirmLabel: 'Replace' }))) return;
    setAiError(null);
    try {
      const person = (staff.data ?? []).find((m) => m.id === employee);
      const res = await actions.aiDraft.mutateAsync(buildAiPayload(aiPrompt, form.template, person as AiStaff | undefined));
      const reply = res.data as AiDraftReply;
      if (aiDraftEmpty(reply)) return setAiError('The AI sent nothing back. Try describing the letter again.');
      setForm((f) => applyAiDraft(f, reply));
      toast.show(aiDraftDone(reply), reply.fallback ? 'info' : 'success');
      setDrafting(false);
    } catch (e) { setAiError(aiErrorText(e)); }
  };

  const save = async () => {
    const problem = validateLetter(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      if (editing === 'new') await actions.create.mutateAsync(buildLetterPayload(form));
      else await actions.update.mutateAsync({ id: (editing as Letter).id, data: buildLetterPayload(form) });
      toast.success('Letter saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const share = async () => {
    const problem = validateLetter(form);
    if (problem) return setError(problem);
    setError(null);
    setBusy('pdf');
    try {
      await shareReportFile(() => lettersApi.generatePdf(buildPdfPayload(form)), letterFileName(form.subject), 'pdf');
    } catch (e) {
      setError((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (l: Letter) => {
    if (!(await confirm({ title: 'Delete this letter?', message: l.subject, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(l.id);
      toast.success('Letter deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete.'));
    }
  };

  const header = <Button title="+ New letter" size="sm" onPress={() => { setForm(emptyLetterForm()); setEmployee(null); setError(null); setEditing('new'); }} />;

  if (q.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={q.data ?? []}
        keyExtractor={(l) => String(l.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No letters" message="Write a letter from a template, then share it as a PDF." />}
        renderItem={({ item: l }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => { setForm(letterToForm(l)); setEmployee(null); setError(null); setEditing(l); }}>
            <Text style={styles.name} numberOfLines={1}>{l.subject}</Text>
            <Text style={styles.sub} numberOfLines={1}>{[l.recipient, l.template_display, l.created_at?.slice(0, 10)].filter(Boolean).join('  ·  ')}</Text>
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New letter' : 'Edit letter'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save letter" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Select label="Template" value={form.template} onChange={pickTemplate}
          options={[{ value: 'custom', label: 'Blank letter' }, ...Object.entries(templates.data ?? {}).map(([k, t]) => ({ value: k, label: t.name }))]} />
        {form.template !== 'custom' ? (
          <Select label="Fill from staff record" searchable value={employee} onChange={fillFromStaff} placeholder="Choose a staff member"
            options={(staff.data ?? []).map((m) => ({ value: m.id, label: `${m.full_name ?? m.name}${m.employee_id ? ` (${m.employee_id})` : ''}` }))} />
        ) : null}
        <Button title="Draft with AI" variant="outline" size="sm" onPress={openDraft} />
        <Input label="Addressed to" value={form.recipient} onChangeText={(v) => set('recipient', v)} />
        <Input label="Subject" value={form.subject} onChangeText={(v) => set('subject', v)} />
        <Input label="Letter" value={form.body} onChangeText={(v) => set('body', v)} multiline style={styles.body} />
        <Select label="Line spacing" value={form.spacing} onChange={(v) => set('spacing', v)} options={LINE_SPACINGS.map((l) => ({ value: l.value, label: l.label }))} />
        <Button title="Share as PDF" variant="outline" onPress={share} loading={busy === 'pdf'} disabled={busy !== null} />
        {editing && editing !== 'new' ? <Button title="Delete letter" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
      <FormSheet visible={drafting} title="Draft with AI" onClose={() => setDrafting(false)} onSubmit={draft} submitLabel="Draft the letter" busy={actions.aiDraft.isPending} error={aiError}>
        <Text style={styles.sub}>{`Say what the letter is for${employee ? ', and it will use the chosen staff member\'s details' : ''}. ${form.template !== 'custom' ? 'It follows the chosen template type. ' : ''}You can edit the result before saving.`}</Text>
        <Input label="What should the letter say?" value={aiPrompt} onChangeText={setAiPrompt} multiline style={styles.body} placeholder="e.g. Experience certificate for 3 years of service as a maths teacher" />
        <Text style={styles.sub}>{`${aiPrompt.trim().length} of ${AI_PROMPT_MAX} characters`}</Text>
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  body: { minHeight: 140, textAlignVertical: 'top' },
});
