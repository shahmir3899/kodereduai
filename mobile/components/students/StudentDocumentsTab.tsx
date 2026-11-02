import React, { useState } from 'react';
import { View, Text, Linking, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { studentsApi } from '../../services/api';
import { canDeleteDocument, docLine, viewableUrl, type StudentDocumentRow } from '../../services/studentMove';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import { useStudentDocuments } from '../../hooks/useStudents';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  studentId: number;
  // Admin and principal can delete; everyone else only sees the list.
  canManage?: boolean;
}

// The student's documents (birth certificate, transfer certificate, medical record). View opens the
// file; Delete removes the record. Adding a document is not offered here yet: the web app only
// stores a placeholder path for it, so a real file upload needs a server change first.
export default function StudentDocumentsTab({ studentId, canManage }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const docs = useStudentDocuments(studentId);
  const [busy, setBusy] = useState<number | null>(null);
  const remove = useMutation({ mutationFn: (docId: number) => studentsApi.deleteDocument(studentId, docId) });

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
  if (rows.length === 0) return <EmptyState title="No documents" message="Nothing has been uploaded for this student." />;

  return (
    <View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
});
