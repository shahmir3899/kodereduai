import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../../services/api';
import {
  CAPTION_LABELS, CAPTION_MAX, PROMOTION_OPTIONS, SIGNATURE_KEYS, bulkMetaBody, captionsOf, formatIssueDate,
  reportMetaError, singleMetaBody, type BulkMetaStudent, type PromotionStatus, type SignatureKey,
} from '../../services/reportCard';
import { todayString } from '../../services/attendanceEntry';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Card from '../ui/Card';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import FormSheet from '../inventory/FormSheet';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing } from '../../constants/colors';
import { SectionError } from '../../components/ui/SectionState';

interface CardIdentity { studentId: number; yearId: number; examIds: number[] }

// The hand-set parts of one card, as in the web card's Edit mode: promotion (final exam only),
// date of issue and the three signature captions. Saved against the card's main exam; the server
// decides who may save (admins, managers, the class teacher) and its reason is shown otherwise.
export function CardDetails({ card, promotionApplicable, promotionStatus, issueDate, signatureLabels, onSaved }: {
  card: CardIdentity;
  promotionApplicable?: boolean;
  promotionStatus?: string;
  issueDate?: string | null;
  signatureLabels?: Record<string, string>;
  onSaved: () => void;
}) {
  const toast = useToast();
  const saved = captionsOf(signatureLabels);
  const [captions, setCaptions] = useState<Record<SignatureKey, string>>(saved);
  const [busy, setBusy] = useState<string | null>(null);
  const savedKey = SIGNATURE_KEYS.map((k) => saved[k]).join('|');
  useEffect(() => { setCaptions(captionsOf(signatureLabels)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (what: string, fields: Parameters<typeof singleMetaBody>[1], done: string) => {
    setBusy(what);
    try {
      await examinationsApi.saveReportCardMeta(singleMetaBody(card, fields));
      toast.success(done);
      onSaved();
    } catch (e) {
      toast.error(reportMetaError(e));
    } finally {
      setBusy(null);
    }
  };
  const captionsChanged = SIGNATURE_KEYS.some((k) => captions[k].trim() !== saved[k]);

  return (
    <Card style={styles.block}>
      <Text style={styles.title}>Print details</Text>
      {promotionApplicable ? (
        <Select<PromotionStatus> label="Promotion status" value={(promotionStatus as PromotionStatus) || 'NOT_APPLICABLE'}
          options={PROMOTION_OPTIONS} disabled={busy !== null}
          onChange={(v) => { if (v !== promotionStatus) save('promotion', { promotion_status: v }, 'Promotion saved.'); }} />
      ) : null}
      <DateField label="Date of issue" value={issueDate || todayString()}
        onChange={(v) => { if (v && v !== issueDate) save('date', { issue_date: v }, `Date of issue set to ${formatIssueDate(v)}.`); }} />
      <Text style={styles.sub}>Signature captions</Text>
      {SIGNATURE_KEYS.map((k) => (
        <Input key={k} label={CAPTION_LABELS[k]} value={captions[k]} maxLength={CAPTION_MAX}
          onChangeText={(t) => setCaptions((c) => ({ ...c, [k]: t }))} />
      ))}
      <Button title="Save captions" size="sm" variant="outline" disabled={!captionsChanged || busy !== null} loading={busy === 'captions'}
        onPress={() => save('captions', { signature_labels: captions }, 'Captions saved.')} />
    </Card>
  );
}

interface ClassStudent { studentId: number; name: string; roll?: string | null }

// The web's "Class bulk edit": one date of issue and one set of captions for everyone listed, and a
// promotion per student (only when the newest ticked exam is a final exam). Blank fields are left
// as they are; "Overwrite" decides whether students who already have a value get the new one.
export function ClassDetailsSheet({ visible, onClose, yearId, examIds, students }: {
  visible: boolean; onClose: () => void; yearId: number; examIds: number[]; students: ClassStudent[];
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const studentIds = students.map((s) => s.studentId);
  const metaQ = useScopedQuery('reportCardBulkMeta', [yearId, examIds.join(','), studentIds.join(',')], async () =>
    (await examinationsApi.getReportCardBulkMeta({
      academic_year_id: yearId, exam_ids: examIds.join(','), student_ids: studentIds.join(','),
    })).data as { main_exam?: { name?: string }; students: Record<string, BulkMetaStudent> },
  { enabled: visible && studentIds.length > 0 && examIds.length > 0, staleTime: 0 });
  const current = metaQ.data?.students ?? {};
  const anyApplicable = Object.values(current).some((v) => v.promotion_applicable);

  const [promotions, setPromotions] = useState<Record<string, PromotionStatus>>({});
  const [issueDate, setIssueDate] = useState('');
  const [captions, setCaptions] = useState<Partial<Record<SignatureKey, string>>>({});
  const [overwrite, setOverwrite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setIssueDate(''); setCaptions({}); setOverwrite(true); setError(null);
  }, [visible]);
  useEffect(() => {
    if (!metaQ.data) return;
    setPromotions(Object.fromEntries(Object.entries(metaQ.data.students).map(([id, v]) => [id, v.promotion_status || 'NOT_APPLICABLE'])));
  }, [metaQ.data]);

  const setAll = (value: PromotionStatus) => setPromotions((p) => {
    const next = { ...p };
    Object.entries(current).forEach(([id, v]) => { if (v.promotion_applicable) next[id] = value; });
    return next;
  });

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await examinationsApi.saveReportCardBulkMeta(bulkMetaBody({
        yearId, examIds, studentIds, overwrite, current, promotions, issueDate, captions,
      }));
      qc.invalidateQueries({ predicate: (q) => ['reportCard', 'reportCardBulkMeta'].includes(String(q.queryKey[0])) });
      toast.success(`Saved for ${students.length} students.`);
      onClose();
    } catch (e) {
      setError(reportMetaError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet visible={visible} title="Class print details" onClose={onClose} onSubmit={submit}
      submitLabel={`Save for ${students.length} students`} busy={busy || metaQ.isLoading} error={error}>
      <Text style={styles.sub}>{students.length} students · saved against {metaQ.data?.main_exam?.name || 'the newest ticked exam'}</Text>
      <DateField label="Date of issue (blank keeps it)" value={issueDate} onChange={setIssueDate} />
      {SIGNATURE_KEYS.map((k) => (
        <Input key={k} label={`${CAPTION_LABELS[k]} caption`} value={captions[k] ?? ''} maxLength={CAPTION_MAX}
          placeholder="Leave blank to keep as is" onChangeText={(t) => setCaptions((c) => ({ ...c, [k]: t }))} />
      ))}
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Overwrite dates, captions and promotions students already have</Text>
        <Switch value={overwrite} onValueChange={setOverwrite} accessibilityLabel="Overwrite existing values" />
      </View>
      <Text style={styles.title}>Promotion status</Text>
      {metaQ.isLoading ? <Skeleton variant="list" /> : metaQ.isError ? (
        <SectionError message={reportMetaError(metaQ.error)} onRetry={() => metaQ.refetch()} />
      ) : !anyApplicable ? (
        <Text style={styles.muted}>Promotion only applies to a final exam. Make a final exam the newest one ticked to set it here.</Text>
      ) : (
        <>
          <Select<PromotionStatus> label="Set everyone to" value={null} options={PROMOTION_OPTIONS} onChange={setAll} placeholder="Choose" />
          {students.map((s) => {
            const id = String(s.studentId);
            const meta = current[id];
            return (
              <Select<PromotionStatus> key={id} label={`${s.roll ? `${s.roll}. ` : ''}${s.name}`}
                value={promotions[id] || 'NOT_APPLICABLE'} options={PROMOTION_OPTIONS} disabled={!meta?.promotion_applicable}
                onChange={(v) => setPromotions((p) => ({ ...p, [id]: v }))} />
            );
          })}
        </>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: Spacing.md, gap: Spacing.xs },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xs },
  switchText: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
});
