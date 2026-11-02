import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { infoSections, monthLine, statusLabel, statusTone, summaryCards } from '../../services/students';
import { photoProblem } from '../../services/profile';
import { exitBanner, type AwayPeriod } from '../../services/studentLifecycle';
import { saveFailureMessage } from '../../services/errorKind';
import { studentsApi } from '../../services/api';
import { balanceOf, feeLabel, formatMoney, statusTone as feeTone, MONTH_NAMES, type FeePayment } from '../../services/feeCollect';
import { formatPercent } from '../../services/examViews';
import {
  useProfileSummary, useStudent, useStudentAttendance, useStudentFees, useStudentResults,
} from '../../hooks/useStudents';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Avatar from '../ui/Avatar';
import BottomSheet from '../ui/BottomSheet';
import StudentAdminActions from './StudentAdminActions';
import StudentHistoryTab from './StudentHistoryTab';
import StudentDocumentsTab from './StudentDocumentsTab';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import Card from '../ui/Card';
import SegmentedTabs from '../ui/SegmentedTabs';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'info' | 'attendance' | 'results' | 'fees' | 'history' | 'documents';
const TONE_COLOR = { success: Colors.success, warning: Colors.warning, error: Colors.error, neutral: Colors.text } as const;

interface Props {
  // Admins can open the edit form; everyone else sees the profile only.
  canEdit?: boolean;
}

const denied = (q: { isError: boolean; error: unknown }) => q.isError && (q.error as any)?.response?.status === 403;

// One student, read-only: details, attendance by month, exam results, and fees. The server decides
// what each role may open, so a tab it refuses says so instead of failing.
export default function StudentProfileScreen({ canEdit }: Props) {
  const router = useRouter();
  const base = usePersonaBase();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const studentId = id ? Number(id) : null;
  const [tab, setTab] = useState<Tab>('info');
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const student = useStudent(studentId);
  const summary = useProfileSummary(studentId);
  const attendance = useStudentAttendance(studentId, tab === 'attendance');
  const results = useStudentResults(studentId, tab === 'results');
  const fees = useStudentFees(studentId, tab === 'fees');
  const refreshControl = useRefreshControl(student.refetch, summary.refetch, attendance.refetch, results.refetch, fees.refetch);

  if (student.isLoading) return <Skeleton variant="detail" />;
  if (student.isError && !student.data) {
    return denied(student) ? <EmptyState title="Not available" message="This student is outside your classes." /> : <ErrorState error={student.error} onRetry={() => student.refetch()} />;
  }
  const s = student.data;
  if (!s) return <EmptyState title="Student not found" />;

  const cards = summaryCards(summary.data, !denied(summary));
  const banner = exitBanner(summary.data?.latest_exit, s.status as string | null | undefined);
  const away = ((s as { away_periods?: AwayPeriod[] }).away_periods ?? []) as AwayPeriod[];
  const sections = infoSections(s);

  const refreshStudent = () => qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit'].includes(q.queryKey[0] as string) });

  // Camera or gallery with the phone's square crop, then upload; same limits as the server.
  const pickPhoto = async (camera: boolean) => {
    setPhotoSheet(false);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.error(camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.'); return; }
    const options = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.7 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ['images'] });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const mime = a.mimeType ?? 'image/jpeg';
    const bad = photoProblem(mime, a.fileSize);
    if (bad) { toast.error(bad); return; }
    setPhotoBusy(true);
    try {
      const body = new FormData();
      body.append('file', { uri: a.uri, name: a.fileName ?? 'student.jpg', type: mime } as unknown as Blob);
      await studentsApi.uploadPhoto(s.id, body);
      await refreshStudent();
      toast.success('Photo updated.');
    } catch (e) { toast.error(saveFailureMessage(e, 'Could not upload the photo.')); } finally { setPhotoBusy(false); }
  };

  const removePhoto = async () => {
    setPhotoSheet(false);
    if (!(await confirm({ title: 'Remove photo?', message: 'Their initials will be shown instead.', confirmLabel: 'Remove', destructive: true }))) return;
    setPhotoBusy(true);
    try { await studentsApi.removePhoto(s.id); await refreshStudent(); toast.success('Photo removed.'); }
    catch (e) { toast.error(saveFailureMessage(e, 'Could not remove the photo.')); } finally { setPhotoBusy(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.head}>
        {canEdit ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Change photo" onPress={() => setPhotoSheet(true)} disabled={photoBusy}>
            <Avatar name={s.name} uri={s.photo_url} size={64} />
            <View style={styles.camBadge}><Text style={styles.camText}>{photoBusy ? '…' : '✎'}</Text></View>
          </TouchableOpacity>
        ) : <Avatar name={s.name} uri={s.photo_url} size={64} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{s.name}</Text>
          <Text style={styles.sub}>{s.roll_number ? `Roll ${s.roll_number}  ·  ` : ''}{s.class_name || ''}</Text>
          {s.status && s.status !== 'ACTIVE' ? <View style={{ marginTop: 4 }}><StatusPill label={statusLabel(s.status)} tone={statusTone(s.status)} /></View> : null}
        </View>
        {canEdit ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`${base}/students/${s.id}/edit` as Href)}>
            <Text style={styles.edit}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {s.status && s.status !== 'ACTIVE' && (s as { status_reason?: string }).status_reason ? (
        <Text style={styles.reason}>Reason: {(s as { status_reason?: string }).status_reason}</Text>
      ) : null}
      {banner ? (
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerTitle}>{banner.headline}</Text>
          {banner.reason ? <Text style={styles.bannerText}>Reason: {banner.reason}</Text> : null}
          {banner.waived.map((w, i) => <Text key={i} style={styles.bannerText}>{w}</Text>)}
        </View>
      ) : null}
      {canEdit ? <StudentAdminActions student={{ id: s.id, name: s.name, status: s.status as string | null | undefined, has_user_account: !!(s as { has_user_account?: boolean }).has_user_account, sectionId: Number((s as { session_class_obj?: number | null }).session_class_obj) || null }} /> : null}

      {cards.length > 0 ? (
        <View style={styles.cards}>
          {cards.map((c) => (
            <View key={c.label} style={styles.card}>
              <Text style={[styles.cardValue, { color: TONE_COLOR[c.tone] }]} numberOfLines={1} adjustsFontSizeToFit>{c.value}</Text>
              <Text style={styles.cardLabel} numberOfLines={2}>{c.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SegmentedTabs<Tab> value={tab} onChange={setTab}
        tabs={[{ value: 'info', label: 'Info' }, { value: 'attendance', label: 'Attendance' }, { value: 'results', label: 'Results' }, { value: 'fees', label: 'Fees' }, { value: 'history', label: 'History' }, { value: 'documents', label: 'Documents' }]} scrollable />

      {tab === 'info' ? (
        sections.length === 0 ? <EmptyState title="No details" /> : (
          <>
            {sections.map((g) => (
              <View key={g.title}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                <Card style={styles.block}>
                  {g.rows.map((r) => (
                    <View key={r.label} style={styles.kv}>
                      <Text style={styles.k}>{r.label}</Text>
                      {r.phone ? (
                        <TouchableOpacity accessibilityRole="link" accessibilityLabel={`Call ${r.label} ${r.value}`} onPress={() => Linking.openURL(`tel:${r.value}`)}>
                          <Text style={[styles.v, styles.link]}>{r.value}</Text>
                        </TouchableOpacity>
                      ) : <Text style={styles.v}>{r.value}</Text>}
                    </View>
                  ))}
                </Card>
              </View>
            ))}
          </>
        )
      ) : null}

      {tab === 'attendance' ? (
        attendance.isLoading ? <Skeleton rows={3} />
          : denied(attendance) ? <EmptyState title="Not available" message="Attendance isn't available for your role." />
          : attendance.isError && !attendance.data ? <ErrorState error={attendance.error} onRetry={() => attendance.refetch()} />
          : (attendance.data ?? []).length === 0 ? <EmptyState title="No attendance yet" />
          : (attendance.data ?? []).map((m, i) => (
            <Card key={`${m.month}-${i}`} style={styles.block}>
              <View style={styles.rowTop}>
                <Text style={styles.title}>{m.month}</Text>
                <Text style={[styles.rate, { color: (m.rate ?? 0) >= 90 ? Colors.success : (m.rate ?? 0) >= 75 ? Colors.warning : Colors.error }]}>
                  {m.rate == null ? '—' : `${Math.round(m.rate)}%`}
                </Text>
              </View>
              <Text style={styles.sub}>{monthLine(m)}</Text>
            </Card>
          ))
      ) : null}

      {tab === 'results' ? (
        results.isLoading ? <Skeleton rows={3} />
          : denied(results) ? <EmptyState title="Not available" message="Results aren't available for your role." />
          : results.isError && !results.data ? <ErrorState error={results.error} onRetry={() => results.refetch()} />
          : (results.data ?? []).length === 0 ? <EmptyState title="No results yet" />
          : (results.data ?? []).map((g) => (
            <Card key={g.exam_id} style={styles.block}>
              <Text style={styles.title}>{g.exam_name}</Text>
              {g.exam_date ? <Text style={styles.sub}>{g.exam_date}</Text> : null}
              {g.subjects.map((sub, i) => (
                <View key={`${sub.subject}-${i}`} style={styles.kv}>
                  <Text style={styles.k} numberOfLines={1}>{sub.subject}</Text>
                  <Text style={styles.v}>
                    {sub.is_absent ? 'Absent' : sub.marks_obtained == null ? '—' : `${sub.marks_obtained}/${sub.total_marks ?? '—'}`}
                    {sub.percentage != null ? `  ${formatPercent(sub.percentage)}` : ''}{sub.grade ? `  ${sub.grade}` : ''}
                  </Text>
                </View>
              ))}
            </Card>
          ))
      ) : null}

      {tab === 'fees' ? (
        fees.isLoading ? <Skeleton rows={3} />
          : denied(fees) ? <EmptyState title="Not available" message="Fee details aren't available for your role." />
          : fees.isError && !fees.data ? <ErrorState error={fees.error} onRetry={() => fees.refetch()} />
          : (fees.data ?? []).length === 0 ? <EmptyState title="No fee records" />
          : (fees.data as unknown as FeePayment[]).map((f) => (
            <Card key={f.id} style={styles.block}>
              <View style={styles.rowTop}>
                <Text style={styles.title}>{feeLabel(f)}{f.month ? `  ·  ${MONTH_NAMES[f.month - 1] ?? ''} ${f.year}` : `  ·  ${f.year}`}</Text>
                <StatusPill label={f.status} tone={feeTone(f.status)} />
              </View>
              <Text style={styles.sub}>
                Due {formatMoney(Number(f.amount_due))}  ·  Received {formatMoney(Number(f.amount_paid))}  ·  Balance {formatMoney(balanceOf(f))}
              </Text>
            </Card>
          ))
      ) : null}
      {tab === 'history' ? <StudentHistoryTab studentId={s.id} awayPeriods={away} /> : null}
      {tab === 'documents' ? <StudentDocumentsTab studentId={s.id} canManage={canEdit} /> : null}

      <BottomSheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title="Student photo">
        <Button title="Take photo" variant="outline" onPress={() => pickPhoto(true)} style={styles.sheetBtn} />
        <Button title="Choose from gallery" variant="outline" onPress={() => pickPhoto(false)} style={styles.sheetBtn} />
        {s.photo_url ? <Button title="Remove photo" variant="danger" onPress={removePhoto} style={styles.sheetBtn} /> : null}
      </BottomSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  edit: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
  cards: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  card: { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center' },
  cardValue: { fontSize: FontSize.lg, fontWeight: '700' },
  cardLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center' },
  reason: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  banner: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, gap: 2 },
  bannerTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  bannerText: { fontSize: FontSize.sm, color: Colors.text },
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  camText: { color: Colors.textInverse, fontSize: 12, fontWeight: '700' },
  groupTitle: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: Spacing.sm },
  link: { color: Colors.primary },
  sheetBtn: { marginBottom: Spacing.sm },
  block: { padding: Spacing.md, marginBottom: Spacing.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: Spacing.md },
  k: { fontSize: FontSize.sm, color: Colors.textSecondary, flexShrink: 1 },
  v: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, flexShrink: 1, textAlign: 'right' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  rate: { fontSize: FontSize.md, fontWeight: '700' },
});
