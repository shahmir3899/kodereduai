import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Linking, TouchableOpacity, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useDocuments, useHrActions, useQualifications, useStaffPicker } from '../../hooks/useHrAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  buildQualificationPayload, documentFields, documentFileProblem, documentToForm, DOCUMENT_TYPES, emptyDocumentForm, emptyQualificationForm, expiryLabel, labelOf,
  qualificationToForm, QUALIFICATION_TYPES, validateDocument, validateQualification, type DocumentForm, type QualificationForm,
  type Qualification, type StaffDocument,
} from '../../services/hrAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'documents' | 'qualifications';

// Staff documents (ID, contract, certificates, medical) and qualifications, for admin and principal.
// A document is a photo, a PDF or a Word file (10 MB at most). Documents that are about to expire or
// already have are flagged.
export default function StaffDocumentsScreen() {
  const [tab, setTab] = useState<Tab>('documents');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs<Tab> tabs={[{ value: 'documents', label: 'Documents' }, { value: 'qualifications', label: 'Qualifications' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'documents' ? <DocumentsTab /> : <QualificationsTab />}
    </View>
  );
}

function DocumentsTab() {
  const toast = useToast();
  const today = todayString();
  const q = useDocuments();
  const staff = useStaffPicker();
  const actions = useHrActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<StaffDocument | 'new' | null>(null);
  const [form, setForm] = useState<DocumentForm>(emptyDocumentForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DocumentForm>(k: K, v: DocumentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const staffOptions = useMemo(() => (staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name })), [staff.data]);

  const open = (d: StaffDocument | 'new') => { setForm(d === 'new' ? emptyDocumentForm() : documentToForm(d)); setError(null); setEditing(d); };

  const pick = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.');
    const result = camera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const bad = documentFileProblem(a.mimeType ?? 'image/jpeg', a.fileSize);
    if (bad) return setError(bad);
    setForm((f) => ({ ...f, fileUri: a.uri, fileName: a.fileName ?? 'document.jpg', mime: a.mimeType ?? 'image/jpeg' }));
  };

  // PDFs and Word files, from the phone's file picker.
  const pickFile = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const bad = documentFileProblem(a.mimeType, a.size);
    if (bad) return setError(bad);
    setForm((f) => ({ ...f, fileUri: a.uri, fileName: a.name, mime: a.mimeType ?? null }));
  };

  const save = async () => {
    const creating = editing === 'new';
    const problem = validateDocument(form, creating);
    if (problem) return setError(problem);
    setError(null);
    try {
      const fields = documentFields(form);
      if (creating || form.fileUri) {
        // New file: multipart, like the web form. An edit with a replacement file sends it the same way.
        const body = new FormData();
        Object.entries(fields).forEach(([k, v]) => body.append(k, v));
        body.append('file', { uri: form.fileUri, name: form.fileName ?? 'document', type: form.mime ?? 'application/octet-stream' } as unknown as Blob);
        if (creating) await actions.createDocument.mutateAsync(body);
        else await actions.updateDocument.mutateAsync({ id: (editing as StaffDocument).id, data: body });
      } else {
        // Details only: JSON keeps the stored file untouched.
        await actions.updateDocument.mutateAsync({ id: (editing as StaffDocument).id, data: { ...fields, expiry_date: form.expiry || null } });
      }
      toast.success('Document saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (d: StaffDocument) => {
    if (!(await confirm({ title: 'Delete document?', message: `${d.title} for ${d.staff_member_name ?? 'this person'}.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteDocument.mutateAsync(d.id);
      toast.success('Document deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the document.')); }
  };

  const busy = actions.createDocument.isPending || actions.updateDocument.isPending;
  const existing = editing && editing !== 'new' ? editing : null;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ Add document" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No documents" emptyMessage="Add IDs, contracts and certificates for your staff.">
          {(list) => list.map((d) => {
            const exp = expiryLabel(d.expiry_date, today);
            return (
              <TouchableOpacity key={d.id} accessibilityRole="button" accessibilityLabel={`${d.title}, ${d.staff_member_name ?? ''}. Open`} style={styles.row} onPress={() => open(d)}>
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>{d.title}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{[d.staff_member_name, labelOf(DOCUMENT_TYPES, d.document_type)].filter(Boolean).join('  ·  ')}</Text>
                </View>
                {exp && exp.tone !== 'neutral' ? <StatusPill label={exp.text} tone={exp.tone} /> : null}
              </TouchableOpacity>
            );
          })}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New document' : 'Document'} onClose={() => setEditing(null)} onSubmit={save} submitLabel="Save" busy={busy} error={error}>
        <Select label="Staff member" searchable value={form.staff} onChange={(v) => set('staff', Number(v))} placeholder="Choose a person" options={staffOptions} disabled={!!existing} />
        <Select label="Type" value={form.type} onChange={(v) => set('type', String(v))} options={DOCUMENT_TYPES} />
        <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} placeholder="e.g. CNIC front" />
        <DateField label="Expiry date (optional)" value={form.expiry} onChange={(v) => set('expiry', v)} />
        <Input label="Notes (optional)" value={form.notes} onChangeText={(v) => set('notes', v)} />
        <Text style={styles.sub}>{form.fileUri ? `File chosen: ${form.fileName}` : existing ? 'The saved file stays unless you choose a new one.' : 'No file chosen yet.'}</Text>
        <View style={styles.pair}>
          <Button title="Take photo" size="sm" variant="outline" style={styles.half} onPress={() => pick(true)} />
          <Button title="Choose photo" size="sm" variant="outline" style={styles.half} onPress={() => pick(false)} />
        </View>
        <Button title="Choose PDF or Word file" size="sm" variant="outline" onPress={pickFile} />
        {existing?.file_url ? <Button title="Open saved file" size="sm" variant="ghost" onPress={() => Linking.openURL(existing.file_url as string)} /> : null}
        {existing ? <Button title="Delete document" variant="danger" size="sm" onPress={() => remove(existing)} /> : null}
      </FormSheet>
    </>
  );
}

function QualificationsTab() {
  const toast = useToast();
  const q = useQualifications();
  const staff = useStaffPicker();
  const actions = useHrActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Qualification | 'new' | null>(null);
  const [form, setForm] = useState<QualificationForm>(emptyQualificationForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof QualificationForm>(k: K, v: QualificationForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const names = useMemo(() => Object.fromEntries((staff.data ?? []).map((s) => [s.id, s.full_name])), [staff.data]);

  const open = (x: Qualification | 'new') => { setForm(x === 'new' ? emptyQualificationForm() : qualificationToForm(x)); setError(null); setEditing(x); };

  const save = async () => {
    const problem = validateQualification(form, new Date().getFullYear());
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildQualificationPayload(form);
      if (editing === 'new') await actions.createQualification.mutateAsync(payload);
      else await actions.updateQualification.mutateAsync({ id: (editing as Qualification).id, data: payload });
      toast.success('Qualification saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (x: Qualification) => {
    if (!(await confirm({ title: 'Delete qualification?', message: x.qualification_name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteQualification.mutateAsync(x.id);
      toast.success('Qualification deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the qualification.')); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Button title="+ Add qualification" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No qualifications" emptyMessage="Record degrees, diplomas and training for your staff.">
          {(list) => list.map((x) => (
            <TouchableOpacity key={x.id} accessibilityRole="button" accessibilityLabel={`${x.qualification_name}. Edit`} style={styles.row} onPress={() => open(x)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{x.qualification_name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[names[x.staff_member], labelOf(QUALIFICATION_TYPES, x.qualification_type), x.institution, x.year_of_completion].filter(Boolean).join('  ·  ')}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>
      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New qualification' : 'Edit qualification'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createQualification.isPending || actions.updateQualification.isPending} error={error}>
        <Select label="Staff member" searchable value={form.staff} onChange={(v) => set('staff', Number(v))} placeholder="Choose a person"
          options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name }))} disabled={editing !== 'new'} />
        <Select label="Type" value={form.type} onChange={(v) => set('type', String(v))} options={QUALIFICATION_TYPES} />
        <Input label="Qualification" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. BSc Mathematics" />
        <Input label="Institution (optional)" value={form.institution} onChangeText={(v) => set('institution', v)} />
        <Input label="Year (optional)" value={form.year} onChangeText={(v) => set('year', v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
        <Input label="Grade or percentage (optional)" value={form.grade} onChangeText={(v) => set('grade', v)} />
        {editing && editing !== 'new' ? <Button title="Delete qualification" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
});
