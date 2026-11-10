import React, { useState } from 'react';
import { View, Text, Linking, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { studentsApi } from '../../services/api';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  DOC_TYPE_OPTIONS, canDeleteDocument, docLine, emptyDocumentForm, newDocumentFields, newDocumentProblem, viewableUrl,
  type NewDocumentForm, type StudentDocumentRow,
} from '../../services/studentMove';
import { documentFileProblem } from '../../services/hrAdmin';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import { useStudentDocuments } from '../../hooks/useStudents';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Input from '../ui/Input';
import Select from '../ui/Select';
import FormSheet from '../inventory/FormSheet';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  studentId: number;
  // Admin and principal can add and delete; everyone else only sees the list.
  canManage?: boolean;
}

// The student's documents (birth certificate, transfer certificate, medical record). View opens the
// file; Add sends a photo, PDF or Word file to the server, which stores it; Delete removes the record
// and its file. Records made on the web before 2026-11 have no file behind them.
export default function StudentDocumentsTab({ studentId, canManage }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const docs = useStudentDocuments(studentId);
  const [busy, setBusy] = useState<number | null>(null);
  const remove = useMutation({ mutationFn: (docId: number) => studentsApi.deleteDocument(studentId, docId) });
  const upload = useMutation({ mutationFn: (body: FormData) => studentsApi.uploadDocument(studentId, body) });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewDocumentForm>(emptyDocumentForm());
  // In a browser the picker hands over a File; a phone gives a uri the upload reads from.
  const [webFile, setWebFile] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => { setForm(emptyDocumentForm()); setWebFile(null); setError(null); setAdding(true); };
  const chosen = (uri: string, name: string, mime: string | null, file?: Blob | null) => {
    setForm((f) => ({ ...f, fileUri: uri, fileName: name, mime }));
    setWebFile(file ?? null);
  };

  const pickPhoto = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.');
    const result = camera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const bad = documentFileProblem(a.mimeType ?? 'image/jpeg', a.fileSize);
    if (bad) return setError(bad);
    chosen(a.uri, a.fileName ?? 'document.jpg', a.mimeType ?? 'image/jpeg', (a as { file?: Blob }).file);
  };

  const pickFile = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const bad = documentFileProblem(a.mimeType, a.size);
    if (bad) return setError(bad);
    chosen(a.uri, a.name, a.mimeType ?? null, (a as { file?: Blob }).file);
  };

  const save = async () => {
    const problem = newDocumentProblem(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const body = new FormData();
      Object.entries(newDocumentFields(form)).forEach(([k, v]) => body.append(k, v));
      if (webFile) body.append('file', webFile, form.fileName ?? 'document');
      else body.append('file', { uri: form.fileUri, name: form.fileName ?? 'document', type: form.mime ?? 'application/octet-stream' } as unknown as Blob);
      await upload.mutateAsync(body);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'studentDocuments' });
      toast.success('Document added.');
      setAdding(false);
    } catch (e) { setError(staffLeaveErrorMessage(e, 'Could not upload the document.')); }
  };

  const denied = docs.isError && (docs.error as { response?: { status?: number } })?.response?.status === 403;

  const del = async (d: StudentDocumentRow) => {
    const ok = await confirm({ title: 'Delete this document?', message: d.title, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    setBusy(d.id);
    try {
      await remove.mutateAsync(d.id);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'studentDocuments' });
      toast.success('Document deleted.');
    } catch (e) { toast.error(staffLeaveErrorMessage(e, 'Could not delete the document.')); }
    finally { setBusy(null); }
  };

  if (docs.isLoading) return <Skeleton rows={3} />;
  if (denied) return <EmptyState title="Not available" message="Documents aren't available for your role." />;
  if (docs.isError && !docs.data) return <ErrorState error={docs.error} onRetry={() => docs.refetch()} />;
  const rows = docs.data ?? [];

  return (
    <View>
      {canManage ? <Button title="Add document" size="sm" variant="outline" onPress={openAdd} style={styles.add} /> : null}
      {rows.length === 0 ? <EmptyState title="No documents" message="Nothing has been uploaded for this student." /> : null}
      {rows.map((d) => {
        const url = viewableUrl(d);
        return (
          <Card key={d.id} style={styles.card}>
            <Text style={styles.title} numberOfLines={2}>{d.title}{d.branch ? `  ·  ${d.branch}` : ''}</Text>
            <Text style={styles.sub}>{docLine(d)}</Text>
            {!url ? <Text style={styles.note}>No file is attached to this record.</Text> : null}
            <View style={styles.actions}>
              {url ? <Button title="View" size="sm" variant="outline" onPress={() => Linking.openURL(url)} /> : null}
              {canManage && canDeleteDocument(d) ? <Button title="Delete" size="sm" variant="danger" loading={busy === d.id} onPress={() => del(d)} /> : null}
            </View>
          </Card>
        );
      })}

      <FormSheet visible={adding} title="Add document" onClose={() => setAdding(false)} onSubmit={save} submitLabel="Upload" busy={upload.isPending} error={error}>
        <Select label="Type" value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: String(v) }))} options={DOC_TYPE_OPTIONS} />
        <Input label="Title (optional)" value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} placeholder="e.g. Birth certificate" />
        <Text style={styles.sub}>{form.fileUri ? `File chosen: ${form.fileName}` : 'No file chosen yet. PDF, photo or Word file, up to 10 MB.'}</Text>
        <View style={styles.actions}>
          <Button title="Take photo" size="sm" variant="outline" onPress={() => pickPhoto(true)} />
          <Button title="Choose photo" size="sm" variant="outline" onPress={() => pickPhoto(false)} />
        </View>
        <Button title="Choose PDF or Word file" size="sm" variant="outline" onPress={pickFile} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  add: { alignSelf: 'flex-start', marginBottom: Spacing.sm },
  card: { marginBottom: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
});
