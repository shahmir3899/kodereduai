import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { examinationsApi, sessionsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { classParams, todayString, type ClassOption } from '../../services/attendanceEntry';
import {
  DEFAULT_SIGNATURE_LABELS, PODIUM, adjacentEnrollment, attendanceNote, attendanceShares, examCell, examNote, examTotal,
  formatClassAvg, formatIssueDate, formatPct, normalizeExamSelection, shortExamName, sortEnrollments, sortExams, stars,
  toggleExam, REPORT_TEMPLATES, normalizeTemplate, reportCardFileName, reportCardPdfError, reportCardPdfParams,
  type Attendance, type EnrollmentRef, type ExamRef, type ReportExam, type ReportTemplate,
} from '../../services/reportCard';
import { shareReportFile } from '../../services/reportShare';
import { loadTemplate, saveTemplate } from '../../services/reportCardPrefs';
import { MONTH_NAMES } from '../../services/assessments';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Select from '../ui/Select';
import MultiSelect from '../ui/MultiSelect';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { CommentRow } from './CommentTools';
import SegmentedTabs from '../ui/SegmentedTabs';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface ReportSubject {
  subject_id: number; subject_name: string; total_marks?: number | string; marks_obtained?: number | null;
  is_absent?: boolean; percentage?: number | null; grade?: string | null; class_avg?: number | string | null;
  is_pass?: boolean | null; comment?: string | null; comment_exam_id?: number | null;
}
interface Report {
  school_name?: string; academic_year_name?: string; exam_display?: string; student_name?: string; roll_number?: string;
  class_name?: string; is_draft?: boolean; weighted?: boolean; class_avg_unit?: string; class_size?: number | null;
  earlier_exam_names?: string[]; main_exam?: { name?: string } | null; exams?: ReportExam[]; subjects?: ReportSubject[];
  summary?: { rank?: number | null; percentage?: number | null; grade?: string | null; total_marks?: number | string;
    obtained_marks?: number | string; overall_pass?: boolean | null } | null;
  attendance?: Attendance | null;
  conduct_assessment?: { month?: number; skills?: ConductItem[]; behaviour?: ConductItem[]; teacher_remark?: string; principal_remark?: string } | null;
  promotion_applicable?: boolean; promotion_status?: string; overall_comment?: string; overall_comment_exam_id?: number | null; issue_date?: string | null;
  signature_labels?: Record<string, string>;
  enrollment_info?: { current_class?: string } | null;
}
interface ConductItem { field: string; label: string; rating?: number | null }
interface Enrollment extends EnrollmentRef { class_name?: string }

interface Props {
  // Class picker for the chosen academic year: teachers get their sections, admins every class.
  useClassOptions: (yearId: number | null) => { options: ClassOption[]; isLoading: boolean; isError?: boolean };
  // Teachers get their first section pre-selected, as on the web.
  autoSelectFirst?: boolean;
}

// View-only report card, one student at a time. The numbers all come from the server; the card is
// keyed to the main (latest) exam. Comments can be edited or regenerated here; the issue date,
// promotion and the PDF stay on the web for now.
export default function ReportCardScreen({ useClassOptions, autoSelectFirst }: Props) {
  const year = useAcademicYear();
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const yearId = pickedYear ?? year.current?.id ?? null;
  const [classId, setClassId] = useState<number | null>(null);
  const [examIds, setExamIds] = useState<number[]>([]);
  const [enrollmentId, setEnrollmentId] = useState<number | null>(null);
  const [template, setTemplate] = useState<ReportTemplate>('enhanced');
  const [sharing, setSharing] = useState(false);
  const toast = useToast();

  // The layout choice is remembered on this phone, like the web remembers it.
  useEffect(() => { loadTemplate().then((t) => setTemplate(normalizeTemplate(t))); }, []);
  const chooseTemplate = (t: ReportTemplate) => { setTemplate(t); saveTemplate(t); };

  const classes = useClassOptions(yearId);
  useEffect(() => {
    if (autoSelectFirst && classId == null && classes.options.length > 0) setClassId(classes.options[0].id);
  }, [autoSelectFirst, classId, classes.options]);

  const option = classes.options.find((o) => o.id === classId) ?? null;
  const masterClassId = option ? (option.classObj ?? option.id) : null;

  const examsQ = useScopedQuery('reportCardExams', [masterClassId, yearId], async () =>
    listOf<ExamRef>((await examinationsApi.getExams({ class_obj: masterClassId, academic_year: yearId, page_size: 9999 })).data),
  { enabled: !!masterClassId && !!yearId, staleTime: 60_000 });
  const exams = useMemo(() => sortExams(examsQ.data ?? []), [examsQ.data]);

  // Default to the latest exam and drop ticks that no longer apply.
  useEffect(() => {
    const next = normalizeExamSelection(examIds, exams);
    if (next.length !== examIds.length || next.some((id, i) => id !== examIds[i])) setExamIds(next);
  }, [exams, examIds]);

  const enrollQ = useScopedQuery('reportCardEnrollments', [classId, yearId], async () =>
    listOf<Enrollment>((await sessionsApi.getEnrollments({ ...classParams(option!, yearId), academic_year: yearId, page_size: 9999 })).data),
  { enabled: !!option && !!yearId });
  const students = useMemo(() => sortEnrollments(enrollQ.data ?? []), [enrollQ.data]);
  const enrollment = students.find((e) => e.id === enrollmentId) ?? null;

  // Fresh each time: a card must reflect marks entered a minute ago.
  const reportQ = useScopedQuery('reportCard', [enrollment?.student ?? null, enrollmentId, yearId, examIds.join(',')], async () =>
    (await examinationsApi.getReportCard({
      student_id: enrollment!.student, enrollment_id: enrollmentId || undefined, academic_year_id: yearId, exam_ids: examIds.join(','),
    })).data as Report,
  { enabled: !!enrollment && !!yearId && examIds.length > 0, staleTime: 0 });
  const refreshControl = useRefreshControl(reportQ.refetch);

  // The server draws the PDF from the same data as the card, then the phone's share sheet opens.
  const sharePdf = async () => {
    if (!enrollment || !yearId) return;
    setSharing(true);
    try {
      const params = reportCardPdfParams({ studentId: enrollment.student, enrollmentId, yearId, examIds, template });
      await shareReportFile(() => examinationsApi.getReportCardPdf(params), reportCardFileName(reportQ.data?.student_name, template), 'pdf');
    } catch (e) {
      toast.error(reportCardPdfError(e));
    } finally {
      setSharing(false);
    }
  };

  const reset = (from: 'year' | 'class') => {
    if (from === 'year') setClassId(null);
    setExamIds([]);
    setEnrollmentId(null);
  };

  if (year.isLoading) return <Skeleton />;
  if (!year.current && !yearId) return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;

  const prev = adjacentEnrollment(students, enrollmentId, -1);
  const next = adjacentEnrollment(students, enrollmentId, 1);
  const report = reportQ.data;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <Select label="Session" value={yearId} options={year.years.map((y) => ({ value: y.id, label: y.name }))}
        onChange={(id) => { if (id !== yearId) { setPickedYear(id); reset('year'); } }} />
      <Select label="Class" value={classId} options={classes.options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => { if (id !== classId) { setClassId(id); reset('class'); } }} placeholder="Select a class" disabled={classes.isLoading} />
      <MultiSelect label="Exams" values={examIds} options={exams.map((e) => ({ value: e.id, label: shortExamName(e.name) }))}
        onToggle={(id) => setExamIds((cur) => toggleExam(cur, id))} placeholder="Select exams" disabled={!option}
        hint="The latest exam decides the result; earlier ones are shown for reference. Up to 4." />
      <Select label="Student" value={enrollmentId} searchable
        options={students.map((s) => ({ value: s.id, label: `${s.roll_number ? `${s.roll_number}. ` : ''}${s.student_name}` }))}
        onChange={setEnrollmentId} placeholder="Select a student" disabled={!option || enrollQ.isLoading} />

      {students.length > 0 && enrollmentId ? (
        <View style={styles.nav}>
          <TouchableOpacity accessibilityRole="button" disabled={!prev} onPress={() => prev && setEnrollmentId(prev.id)}>
            <Text style={[styles.navBtn, !prev && styles.navOff]}>‹ Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={!next} onPress={() => next && setEnrollmentId(next.id)}>
            <Text style={[styles.navBtn, !next && styles.navOff]}>Next ›</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!enrollment ? (
        <EmptyState title="Pick a student" message="Choose a class and a student to see their report card." />
      ) : reportQ.isLoading ? (
        <Skeleton />
      ) : reportQ.isError && !report ? (
        <ErrorState message={(reportQ.error as any)?.response?.data?.detail} onRetry={() => reportQ.refetch()} />
      ) : report ? (
        <>
          <Card style={styles.pdfBar}>
            <Text style={styles.pdfTitle}>PDF layout</Text>
            <SegmentedTabs tabs={REPORT_TEMPLATES} value={template} onChange={chooseTemplate} />
            <Button title="Share report card PDF" onPress={sharePdf} loading={sharing} disabled={sharing} fullWidth />
          </Card>
        <Card_ report={report} studentId={enrollment.student} onChanged={() => reportQ.refetch()} />
        </>
      ) : null}
    </ScrollView>
  );
}

function Card_({ report, studentId, onChanged }: { report: Report; studentId: number; onChanged: () => void }) {
  const subjects = report.subjects ?? [];
  const exams = report.exams ?? [];
  const multi = exams.length > 1;
  const summary = report.summary;
  const att = report.attendance;
  const podium = summary?.rank ? PODIUM[summary.rank] : undefined;
  const note = examNote(report);
  const conduct = report.conduct_assessment;
  // Edit and regenerate go to the exam each comment belongs to (the main, latest exam of the card).
  const editableComments = [
    ...(report.overall_comment_exam_id
      ? [{ key: 'overall', examId: report.overall_comment_exam_id, row: { key: 'overall', label: 'Overall', subjectId: null, text: report.overall_comment ?? '', source: null } }]
      : []),
    ...subjects.filter((s) => s.comment_exam_id).map((s) => ({
      key: `s${s.subject_id}`, examId: s.comment_exam_id as number,
      row: { key: `s${s.subject_id}`, label: s.subject_name, subjectId: s.subject_id, text: s.comment ?? '', source: null },
    })),
  ];
  const subjectIds = subjects.map((s) => s.subject_id);
  const issue = report.issue_date || todayString();
  const sig = { ...DEFAULT_SIGNATURE_LABELS, ...(report.signature_labels || {}) };

  return (
    <View>
      {report.is_draft ? (
        <View style={styles.draft}><Text style={styles.draftText}><Text style={styles.bold}>Draft</Text> — results have not been announced yet. Only staff can see this preview.</Text></View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.school}>{report.school_name || 'Report Card'}</Text>
        <Text style={styles.headerSub}>
          {report.academic_year_name ? `Academic Year: ${report.academic_year_name}` : ''}{report.exam_display ? ` | ${report.exam_display}` : ''}
        </Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>

      <Card style={styles.block}>
        <Row k="Student" v={report.student_name} />
        <Row k="Roll no." v={report.roll_number} />
        <Row k="Class" v={report.class_name} />
        {report.enrollment_info?.current_class && report.enrollment_info.current_class !== report.class_name
          ? <Row k="Current class" v={report.enrollment_info.current_class} /> : null}
      </Card>

      {podium ? (
        <View style={[styles.podium, { backgroundColor: podium.bg }]}>
          <Text style={styles.podiumIcon}>{podium.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.podiumTitle, { color: podium.fg }]}>{podium.label}</Text>
            <Text style={[styles.podiumSub, { color: podium.fg }]}>Congratulations! {report.class_name}{summary?.percentage != null ? ` · ${Number(summary.percentage).toFixed(1)}%` : ''}</Text>
          </View>
        </View>
      ) : null}

      {att && att.working_days > 0 ? <AttendanceBlock a={att} /> : null}

      <Text style={styles.section}>Marks</Text>
      {subjects.length === 0 ? (
        <Text style={styles.muted}>No subject marks available.</Text>
      ) : (
        subjects.map((s) => (
          <Card key={s.subject_id} style={{ ...styles.subject, ...(s.is_pass === false ? styles.subjectFail : null) }}>
            <View style={styles.subjectTop}>
              <Text style={styles.subjectName} numberOfLines={1}>{s.subject_name}</Text>
              {s.grade ? <Text style={styles.grade}>{s.grade}</Text> : null}
              {s.is_pass === true ? <StatusPill label="Pass" tone="success" /> : s.is_pass === false ? <StatusPill label="Fail" tone="error" /> : null}
            </View>
            {multi ? (
              <View style={styles.examRow}>
                {exams.map((e) => (
                  <View key={e.exam_id} style={styles.examCell}>
                    <Text style={styles.examName} numberOfLines={1}>{shortExamName(e.exam_name)}{report.weighted && e.weight != null ? ` ${e.weight}%` : ''}</Text>
                    <Text style={[styles.examValue, e.is_main ? styles.examMain : styles.examEarlier]}>{examCell(e, s.subject_id)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.marks}>
                {s.is_absent ? <Text style={{ color: Colors.error }}>Absent</Text> : (s.marks_obtained ?? '—')}
                <Text style={styles.of}> / {s.total_marks}</Text>
              </Text>
            )}
            <Text style={styles.meta}>
              {report.weighted && multi ? 'Result' : ''} {formatPct(s.percentage)}  ·  Class avg {formatClassAvg(s.class_avg, report.class_avg_unit)}
            </Text>
          </Card>
        ))
      )}

      {summary ? (
        <Card style={styles.total}>
          <Text style={styles.totalTitle}>Total</Text>
          {multi ? (
            <View style={styles.examRow}>
              {exams.map((e) => (
                <View key={e.exam_id} style={styles.examCell}>
                  <Text style={styles.examName} numberOfLines={1}>{shortExamName(e.exam_name)}</Text>
                  <Text style={[styles.examValue, e.is_main ? styles.examMain : styles.examEarlier]}>{examTotal(e, subjectIds)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.marks}>{summary.obtained_marks ?? '—'}<Text style={styles.of}> / {summary.total_marks ?? '—'}</Text></Text>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.meta}>{report.weighted ? 'Result %' : 'Percentage'} {formatPct(summary.percentage)}</Text>
            {summary.grade ? <Text style={styles.grade}>{summary.grade}</Text> : null}
            {summary.overall_pass === true ? <StatusPill label="Pass" tone="success" /> : summary.overall_pass === false ? <StatusPill label="Fail" tone="error" /> : null}
          </View>
          {summary.rank ? <Text style={styles.meta}>Position {summary.rank}{report.class_size ? ` of ${report.class_size}` : ''}</Text> : null}
        </Card>
      ) : null}

      {conduct ? (
        <>
          <Text style={styles.section}>Skills &amp; Behaviour{conduct.month ? ` — ${MONTH_NAMES[conduct.month - 1]}` : ''}</Text>
          <Card style={styles.block}>
            {[...(conduct.skills ?? []), ...(conduct.behaviour ?? [])].map((it) => (
              <View key={it.field} style={styles.starRow}>
                <Text style={styles.starLabel}>{it.label}</Text>
                <Text style={styles.stars} accessibilityLabel={`${it.rating || 0} of 5`}>{stars(it.rating)}</Text>
              </View>
            ))}
            {conduct.teacher_remark ? <Remark who="Class teacher" text={conduct.teacher_remark} /> : null}
            {conduct.principal_remark ? <Remark who="Principal" text={conduct.principal_remark} /> : null}
          </Card>
        </>
      ) : null}

      {report.promotion_applicable && report.promotion_status && report.promotion_status !== 'NOT_APPLICABLE' ? (
        <View style={[styles.promotion, report.promotion_status === 'PROMOTED' ? styles.promoted : styles.notPromoted]}>
          <Text style={[styles.promotionText, { color: report.promotion_status === 'PROMOTED' ? Colors.success : Colors.error }]}>
            {report.promotion_status === 'PROMOTED' ? 'Promoted' : 'Not Promoted'}
          </Text>
        </View>
      ) : null}

      <Text style={styles.section}>Comments</Text>
      <Card style={styles.block}>
        {editableComments.length === 0 ? <Text style={styles.muted}>No exam to attach a comment to yet.</Text> : null}
        {editableComments.map((c) => (
          <CommentRow key={c.key} row={c.row} showSource={false}
            onSave={async (comment) => { await examinationsApi.editComment(c.examId, { studentId, subjectId: c.row.subjectId, comment }); onChanged(); }}
            onRegenerate={async () => { await examinationsApi.regenerateComment(c.examId, { studentId, subjectId: c.row.subjectId }); onChanged(); }} />
        ))}
      </Card>

      <Card style={styles.block}>
        <Row k="Date of issue" v={formatIssueDate(issue)} />
        <Text style={styles.sig}>{sig.class_teacher}  ·  {sig.principal}  ·  {sig.parent}</Text>
      </Card>
    </View>
  );
}

function AttendanceBlock({ a }: { a: Attendance }) {
  const share = attendanceShares(a);
  const note = attendanceNote(a);
  return (
    <Card style={styles.block}>
      <Text style={styles.eyebrow}>Attendance</Text>
      <Text style={styles.attMain}>{a.present} / {a.working_days} days{a.percentage != null ? <Text style={styles.attPct}> ({a.percentage}%)</Text> : null}</Text>
      {a.from && a.to ? <Text style={styles.meta}>{formatIssueDate(a.from)} – {formatIssueDate(a.to)}</Text> : null}
      <View style={styles.bar}>
        <View style={{ width: `${share.present}%`, backgroundColor: Colors.success }} />
        <View style={{ width: `${share.absent}%`, backgroundColor: Colors.error }} />
        <View style={{ width: `${share.leave}%`, backgroundColor: Colors.warning }} />
      </View>
      <Text style={styles.meta}>Present {a.present}  ·  Absent {a.absent}  ·  Leave {a.leave}{a.not_marked > 0 ? `  ·  Not marked ${a.not_marked}` : ''}</Text>
      {note ? <Text style={[styles.attNote, a.suspect && { color: Colors.warning }]}>{note}</Text> : null}
    </Card>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v} numberOfLines={1}>{v || '—'}</Text>
    </View>
  );
}

function Remark({ who, text }: { who: string; text: string }) {
  return (
    <View style={styles.remark}>
      <Text style={styles.eyebrow}>{who}</Text>
      <Text style={styles.remarkText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pdfBar: { marginBottom: Spacing.md },
  pdfTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.md },
  navBtn: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '600', paddingVertical: Spacing.xs },
  navOff: { color: Colors.border },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  bold: { fontWeight: '700' },
  draft: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  draftText: { fontSize: FontSize.sm, color: Colors.warning },
  header: { alignItems: 'center', paddingBottom: Spacing.md, marginBottom: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  school: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  headerSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4, textAlign: 'center' },
  block: { padding: Spacing.md, marginBottom: Spacing.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  k: { fontSize: FontSize.sm, color: Colors.textSecondary },
  v: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, flexShrink: 1, marginLeft: Spacing.md },
  podium: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  podiumIcon: { fontSize: 34 },
  podiumTitle: { fontSize: FontSize.md, fontWeight: '700', textTransform: 'uppercase' },
  podiumSub: { fontSize: FontSize.sm },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginVertical: Spacing.md },
  subject: { padding: Spacing.md, marginBottom: Spacing.sm },
  subjectFail: { backgroundColor: Colors.errorLight },
  subjectTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  subjectName: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  grade: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.info },
  marks: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  of: { fontSize: FontSize.sm, fontWeight: '400', color: Colors.textSecondary },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  examRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  examCell: { flex: 1 },
  examName: { fontSize: 10, color: Colors.textSecondary },
  examValue: { fontSize: FontSize.sm, marginTop: 2 },
  examMain: { fontWeight: '700', color: Colors.text },
  examEarlier: { color: Colors.textTertiary },
  total: { padding: Spacing.md, marginBottom: Spacing.md, backgroundColor: Colors.surfaceSecondary },
  totalTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  eyebrow: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  attMain: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.success, marginTop: 2 },
  attPct: { fontSize: FontSize.sm, fontWeight: '500' },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: Colors.border, marginVertical: Spacing.sm },
  attNote: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  starRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  starLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  stars: { fontSize: FontSize.md, color: '#f59e0b' },
  remark: { marginTop: Spacing.sm },
  remarkText: { fontSize: FontSize.sm, color: Colors.text, fontStyle: 'italic', marginTop: 2 },
  promotion: { borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, alignItems: 'center', borderWidth: 1 },
  promoted: { backgroundColor: Colors.successLight, borderColor: Colors.success },
  notPromoted: { backgroundColor: Colors.errorLight, borderColor: Colors.error },
  promotionText: { fontSize: FontSize.md, fontWeight: '700', textTransform: 'uppercase' },
  sig: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.sm, textAlign: 'center' },
});
