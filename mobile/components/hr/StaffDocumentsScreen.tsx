import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { hrApi } from '../../services/api';
import { appendFile } from '../../services/formFile';
import {
  SCAN_STATUS, STAFF_DOC_TYPES, anyReading, scanError, scanReplyMessage, typeLabel, type ScannedDoc,
} from '../../services/documentScan';
import { pickDocumentFile } from '../documents/pickDocumentFile';
import DocumentDetailsSheet from '../documents/DocumentDetailsSheet';
import { useDocuments, useHrActions, useQualifications, useStaffPicker } from '../../hooks/useHrAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  buildQualificationPayload, emptyQualificationForm, expiryLabel, labelOf,
  qualificationToForm, QUALIFICATION_TYPES, validateQualification, type QualificationForm, type Qualification,
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

// Staff documents (read from a photo) and qualifications, for admin and principal. Documents that are
// about to expire or already have are flagged.
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

const POLL_MS = 3000;

// Staff documents (web StaffDocumentsPage). Adding one is image-only: choose the person (never guessed
// from the picture), then take a photo or choose a file; the server reads the record from it in the
// background ("Reading…" until it is done). Open a record to check and correct what was read; a
// degree, diploma, certification, training or licence also fills the person's qualifications.
function DocumentsTab() {
  const toast = useToast();
  const today = todayString();
  const q = useDocuments();
  const staff = useStaffPicker();
  const actions = useHrActions();
  const refreshControl = useRefreshControl(q.refetch);
  const rows = (q.data ?? []) as unknown as ScannedDoc[];
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [open, setOpen] = useState<ScannedDoc | null>(null);
  const staffOptions = useMemo(() => (staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name })), [staff.data]);

  // While the server is still reading a picture, keep checking until it is done.
  const reading = anyReading(rows);
  useEffect(() => {
    if (!reading) return undefined;
    const t = setInterval(() => { q.refetch(); }, POLL_MS);
    return () => clearInterval(t);
  }, [reading]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (source: 'camera' | 'gallery' | 'file') => {
    setAddError(null);
    if (!person) return setAddError('Choose the staff member first.');
    const picked = await pickDocumentFile(source);
    if (!picked) return;
    if ('error' in picked) return setAddError(picked.error);
    setUploading(true);
    try {
      const body = new FormData();
      body.append('staff_member', String(person));
      await appendFile(body, 'file', picked.file);
      const res = await hrApi.scanDocument(body);
      toast.success(scanReplyMessage(res.data as { duplicate?: boolean }));
      await q.refetch();
      setAdding(false);
    } catch (e) { setAddError(scanError(e)); }
    finally { setUploading(false); }
  };

  const remove = async (d: ScannedDoc): Promise<boolean> => {
    const message = `${d.title} for ${d.staff_member_name ?? 'this person'}. Its file and any qualification read from it are deleted too. This cannot be undone.`;
    if (!(await confirm({ title: 'Delete document?', message, confirmLabel: 'Delete', destructive: true }))) return false;
    await actions.deleteDocument.mutateAsync(d.id);
    toast.success('Document deleted.');
    return true;
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ Add document" size="sm" onPress={() => { setAddError(null); setAdding(true); }} />
        <QueryBoundary query={q} emptyTitle="No documents" emptyMessage="Add IDs, contracts and certificates for your staff.">
          {() => rows.map((d) => {
            const exp = expiryLabel(d.expiry_date, today);
            const scan = d.scan_status ? SCAN_STATUS[d.scan_status] : undefined;
            return (
              <TouchableOpacity key={d.id} accessibilityRole="button" accessibilityLabel={`${d.title}, ${d.staff_member_name ?? ''}. Open`} style={styles.row}
                disabled={d.scan_status === 'PENDING'} onPress={() => setOpen(d)}>
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>{d.title}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{[d.staff_member_name, typeLabel(STAFF_DOC_TYPES, d.document_type), d.document_number].filter(Boolean).join('  ·  ')}</Text>
                </View>
                {scan ? <StatusPill label={scan.label} tone={scan.tone} /> : exp && exp.tone !== 'neutral' ? <StatusPill label={exp.text} tone={exp.tone} /> : null}
              </TouchableOpacity>
            );
          })}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={adding} title="Add document" onClose={() => setAdding(false)} onSubmit={() => setAdding(false)} submitLabel="Close" busy={uploading} error={addError}>
        <Select label="Staff member" searchable value={person} onChange={(v) => setPerson(Number(v))} placeholder="Choose a person" options={staffOptions} />
        <Text style={styles.sub}>Then take a photo of the page or choose a file. The details are read from it; check them afterwards.</Text>
        <View style={styles.pair}>
          <Button title="Take photo" size="sm" variant="outline" style={styles.half} onPress={() => upload('camera')} disabled={uploading} />
          <Button title="Choose photo" size="sm" variant="outline" style={styles.half} onPress={() => upload('gallery')} disabled={uploading} />
        </View>
        <Button title="Choose PDF or Word file" size="sm" variant="outline" onPress={() => upload('file')} disabled={uploading} />
        {uploading ? <Text style={styles.sub}>Uploading...</Text> : null}
      </FormSheet>

      <DocumentDetailsSheet doc={open} types={STAFF_DOC_TYPES} canEdit onClose={() => setOpen(null)}
        onSave={async (payload) => { await actions.updateDocument.mutateAsync({ id: open!.id, data: payload }); toast.success('Saved.'); }}
        onRescan={async () => {
          const res = await hrApi.rescanDocument(open!.id);
          const dup = (res.data as { duplicate?: boolean })?.duplicate;
          toast.success(dup ? 'This was a copy of a document already on file, so it was not kept.' : 'Reading the picture again.');
          await q.refetch();
        }}
        onDelete={() => remove(open!)} />
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
