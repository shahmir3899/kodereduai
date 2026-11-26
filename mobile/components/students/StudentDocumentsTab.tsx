import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { studentsApi } from '../../services/api';
import { appendFile } from '../../services/formFile';
import {
  SCAN_STATUS, STUDENT_DOC_TYPES, anyReading, docSubline, scanError, scanReplyMessage, type ScannedDoc,
} from '../../services/documentScan';
import { canDeleteDocument } from '../../services/studentMove';
import { useStudentDocuments } from '../../hooks/useStudents';
import { pickDocumentFile } from '../documents/pickDocumentFile';
import DocumentDetailsSheet from '../documents/DocumentDetailsSheet';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  studentId: number;
  // Admin and principal can add, correct and delete; everyone else only sees the list.
  canManage?: boolean;
}

const POLL_MS = 3000;

// The student's documents (web StudentDocumentsTab). Adding one is image-only: take a photo or choose
// a file and the server reads the record from it (type, title, number, dates) in the background; the
// list shows "Reading…" until it is done. Open a record to check and correct what was read. Rows from
// an earlier branch can be opened but not changed.
export default function StudentDocumentsTab({ studentId, canManage }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const docs = useStudentDocuments(studentId);
  const rows = (docs.data ?? []) as ScannedDoc[];
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<ScannedDoc | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'studentDocuments' });

  // While the server is still reading a picture, keep checking until it is done.
  const reading = anyReading(rows);
  useEffect(() => {
    if (!reading) return undefined;
    const t = setInterval(() => { docs.refetch(); }, POLL_MS);
    return () => clearInterval(t);
  }, [reading]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (source: 'camera' | 'gallery' | 'file') => {
    setPickError(null);
    const picked = await pickDocumentFile(source);
    if (!picked) return;
    if ('error' in picked) return setPickError(picked.error);
    setUploading(true);
    try {
      const body = new FormData();
      await appendFile(body, 'file', picked.file);
      const res = await studentsApi.scanDocument(studentId, body);
      toast.success(scanReplyMessage(res.data as { duplicate?: boolean }));
      await refresh();
    } catch (e) { setPickError(scanError(e)); }
    finally { setUploading(false); }
  };

  const del = async (d: ScannedDoc): Promise<boolean> => {
    const ok = await confirm({ title: 'Delete this document?', message: `${d.title}. Its file is deleted too. This cannot be undone.`, confirmLabel: 'Delete', destructive: true });
    if (!ok) return false;
    await studentsApi.deleteDocument(studentId, d.id);
    toast.success('Document deleted.');
    await refresh();
    return true;
  };

  const denied = docs.isError && (docs.error as { response?: { status?: number } })?.response?.status === 403;
  if (docs.isLoading) return <Skeleton rows={3} />;
  if (denied) return <EmptyState title="Not available" message="Documents aren't available for your role." />;
  if (docs.isError && !docs.data) return <ErrorState error={docs.error} onRetry={() => docs.refetch()} />;

  return (
    <View>
      {canManage ? (
        <Card style={styles.card}>
          <Text style={styles.title}>Add a document</Text>
          <Text style={styles.sub}>Take a photo of the page or choose a file. The details are read from it; check them afterwards.</Text>
          <View style={styles.actions}>
            <Button title="Take photo" size="sm" variant="outline" onPress={() => add('camera')} disabled={uploading} />
            <Button title="Choose photo" size="sm" variant="outline" onPress={() => add('gallery')} disabled={uploading} />
            <Button title="PDF or Word" size="sm" variant="outline" onPress={() => add('file')} disabled={uploading} />
          </View>
          {uploading ? <Text style={styles.sub}>Uploading...</Text> : null}
          {pickError ? <Text style={styles.error} accessibilityRole="alert">{pickError}</Text> : null}
        </Card>
      ) : null}
      {rows.length === 0 ? <EmptyState title="No documents" message="Nothing has been uploaded for this student." /> : null}
      {rows.map((d) => {
        const scan = d.scan_status ? SCAN_STATUS[d.scan_status] : undefined;
        return (
          <Card key={d.id} style={styles.card}>
            <Text style={styles.title} numberOfLines={2}>{d.title}</Text>
            <Text style={styles.sub}>{docSubline(d, STUDENT_DOC_TYPES)}</Text>
            <View style={styles.pills}>
              {scan ? <StatusPill label={scan.label} tone={scan.tone} /> : null}
              {d.branch ? <StatusPill label={d.branch} tone="neutral" /> : null}
            </View>
            {d.scan_status !== 'PENDING' ? (
              <Button title={canManage && canDeleteDocument(d) ? 'View / edit' : 'View'} size="sm" variant="outline" onPress={() => setOpen(d)} style={styles.open} />
            ) : null}
          </Card>
        );
      })}
      <DocumentDetailsSheet doc={open} types={STUDENT_DOC_TYPES} canEdit={!!canManage && !!open && canDeleteDocument(open)} onClose={() => setOpen(null)}
        onSave={async (payload) => { await studentsApi.updateDocumentDetails(studentId, open!.id, payload); toast.success('Saved.'); await refresh(); }}
        onRescan={async () => {
          const res = await studentsApi.rescanDocument(studentId, open!.id);
          toast.success((res.data as { duplicate?: boolean })?.duplicate ? 'This was a copy of a document already on file, so it was not kept.' : 'Reading the picture again.');
          await refresh();
        }}
        onDelete={() => del(open!)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.sm, gap: 2 },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  error: { fontSize: FontSize.sm, color: Colors.error, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, flexWrap: 'wrap' },
  pills: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  open: { alignSelf: 'flex-start', marginTop: Spacing.sm },
});
