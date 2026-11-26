import React, { useEffect, useState } from 'react';
import { View, Text, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import {
  QUALIFICATION_DOC_TYPES, SCAN_STATUS, detailsForm, detailsPayload, isImageUrl, scanError, validateDetails,
  type DetailsForm, type ScannedDoc,
} from '../../services/documentScan';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import StatusPill from '../ui/StatusPill';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  doc: ScannedDoc | null;
  types: Array<{ value: string; label: string }>;
  canEdit: boolean;
  withExpiry?: boolean;
  withNotes?: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onRescan: () => Promise<unknown>;
  // Resolves false when the person cancelled the confirm: the sheet then stays open.
  onDelete?: () => Promise<boolean>;
}

// One document record next to its picture (web DocumentEditModal): check what was read, correct it
// and save (a saved record no longer needs review), read the picture again, open the file, delete.
export default function DocumentDetailsSheet({ doc, types, canEdit, withExpiry = true, withNotes = true, onClose, onSave, onRescan, onDelete }: Props) {
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (doc) { setForm(detailsForm(doc)); setError(null); } }, [doc]);
  if (!doc || !form) return null;
  const set = <K extends keyof DetailsForm>(k: K, v: DetailsForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const status = doc.scan_status ? SCAN_STATUS[doc.scan_status] : undefined;
  const isQual = QUALIFICATION_DOC_TYPES.includes(form.type);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); onClose(); } catch (e) { setError(scanError(e, 'Could not save.')); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { if ((await onDelete!()) !== false) onClose(); } catch (e) { setError(scanError(e, 'Could not delete the document.')); } finally { setBusy(false); }
  };
  const save = () => {
    const problem = validateDetails(form, new Date().getFullYear());
    if (problem) return setError(problem);
    run(() => onSave(detailsPayload(form, { withExpiry, withNotes })));
  };

  return (
    <FormSheet visible title={canEdit ? 'Document details' : 'Document'} onClose={onClose} onSubmit={canEdit ? save : onClose}
      submitLabel={canEdit ? 'Save' : 'Close'} busy={busy} error={error}
      secondaryLabel={canEdit && onDelete ? 'Delete document' : undefined} onSecondary={canEdit && onDelete ? remove : undefined}>
      {doc.file_url && isImageUrl(doc.file_url) ? (
        <Image source={{ uri: doc.file_url }} style={styles.picture} contentFit="contain" accessibilityLabel="The document's picture" />
      ) : <Text style={styles.note}>{doc.file_url ? 'This file has no preview.' : 'No file is attached to this record.'}</Text>}
      <View style={styles.row}>
        {status ? <StatusPill label={status.label} tone={status.tone} /> : null}
        {doc.file_url ? <Button title="Open file" size="sm" variant="ghost" onPress={() => Linking.openURL(doc.file_url as string)} /> : null}
      </View>
      {doc.scan_note ? <Text style={styles.note}>{doc.scan_note}</Text> : null}
      <Select label="Type" value={form.type} options={types} onChange={(v) => set('type', String(v))} disabled={!canEdit} />
      <Input label="Title" value={form.title} onChangeText={(t) => set('title', t)} editable={canEdit} />
      <Input label="Document number (optional)" value={form.number} onChangeText={(t) => set('number', t)} editable={canEdit} />
      <DateField label="Issue date (optional)" value={form.issued} onChange={(v) => canEdit && set('issued', v)} />
      {withExpiry ? <DateField label="Expiry date (optional)" value={form.expiry} onChange={(v) => canEdit && set('expiry', v)} /> : null}
      {isQual ? (
        <>
          <Input label="Institution (optional)" value={form.institution} onChangeText={(t) => set('institution', t)} editable={canEdit} />
          <Input label="Year of completion (optional)" value={form.year} keyboardType="number-pad" onChangeText={(t) => set('year', t.replace(/\D/g, '').slice(0, 4))} editable={canEdit} />
          <Input label="Grade or percentage (optional)" value={form.grade} onChangeText={(t) => set('grade', t)} editable={canEdit} />
        </>
      ) : null}
      {withNotes ? <Input label="Notes (optional)" value={form.notes} multiline onChangeText={(t) => set('notes', t)} editable={canEdit} /> : null}
      {canEdit && doc.file_url ? (
        <Button title="Read the picture again" size="sm" variant="outline" disabled={busy} onPress={() => run(onRescan)} />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  picture: { width: '100%', height: 220, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
});
