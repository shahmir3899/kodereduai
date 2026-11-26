import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { examinationsApi, studentsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import {
  draftsFromSaved, emptyDraft, enteredCount, plainQuestion, questionMarks, responseRows, savedMessage, validateDrafts,
  type DraftMap, type PaperQuestionLite, type SavedResponse,
} from '../../services/studentResponses';
import { reportMetaError } from '../../services/reportCard';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Paper { id: number; paper_title?: string; subject_name?: string; class_name?: string; class_obj?: number; paper_questions?: PaperQuestionLite[] }
interface StudentLite { id: number; name: string; roll_number?: string | null }

const CORRECT: Array<{ value: boolean | null; label: string }> = [{ value: true, label: 'Right' }, { value: false, label: 'Wrong' }, { value: null, label: 'Not marked' }];

// What each student answered on a paper, question by question (web StudentResponsePage, opened from
// Papers > Responses): the answer, the marks given and right/wrong. Saved per student.
export default function StudentResponsesScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const paperId = id ? Number(id) : null;
  const toast = useToast();
  const qc = useQueryClient();
  const year = useAcademicYear({ lockToCurrent: true });
  const paperQ = useScopedQuery<Paper>('paperResponsesPaper', [paperId], async () => (await examinationsApi.getExamPaper(paperId!)).data as Paper, { enabled: !!paperId });
  const paper = paperQ.data;
  const questions = useMemo(() => paper?.paper_questions ?? [], [paper]);
  const studentsQ = useScopedQuery<StudentLite[]>('paperResponsesStudents', [paper?.class_obj ?? null, year.current?.id ?? null], async () =>
    listOf<StudentLite>((await studentsApi.getStudents({ class_obj: paper!.class_obj, academic_year: year.current?.id, page_size: 500 })).data),
  { enabled: !!paper?.class_obj });
  const students = studentsQ.data ?? [];
  const [studentId, setStudentId] = useState<number | null>(null);
  useEffect(() => { if (!studentId && students.length) setStudentId(students[0].id); }, [students, studentId]);

  const savedQ = useScopedQuery<SavedResponse[]>('paperResponses', [paperId, studentId], async () =>
    listOf<SavedResponse>((await examinationsApi.getStudentResponses({ exam_paper: paperId!, student: studentId!, page_size: 500 })).data),
  { enabled: !!paperId && !!studentId, staleTime: 0 });
  const allQ = useScopedQuery<Array<{ student?: number }>>('paperResponsesAll', [paperId], async () =>
    listOf<{ student?: number }>((await examinationsApi.getStudentResponses({ exam_paper: paperId!, page_size: 2000 })).data),
  { enabled: !!paperId, staleTime: 0 });

  const [drafts, setDrafts] = useState<DraftMap>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDrafts(draftsFromSaved(savedQ.data ?? [])); }, [savedQ.data, studentId]);

  const edit = (q: number, patch: Partial<DraftMap[number]>) => setDrafts((d) => ({ ...d, [q]: { ...emptyDraft(), ...d[q], ...patch } }));
  const idx = students.findIndex((s) => s.id === studentId);

  const save = async () => {
    if (!paperId || !studentId) return;
    const problem = validateDrafts(questions, drafts);
    if (problem) return toast.error(problem);
    const rows = responseRows(questions, drafts);
    if (rows.length === 0) return toast.error('Enter at least one answer, mark or right/wrong first.');
    setBusy(true);
    try {
      const res = await examinationsApi.submitStudentResponses({ exam_paper: paperId, student: studentId, responses: rows });
      toast.success(savedMessage(res.data as { created_count?: number; updated_count?: number }));
      qc.invalidateQueries({ predicate: (q) => ['paperResponses', 'paperResponsesAll'].includes(String(q.queryKey[0])) });
    } catch (e) { toast.error(reportMetaError(e)); } finally { setBusy(false); }
  };

  if (!paperId) return <EmptyState title="No paper" message="Open Responses from a paper in the Papers list." />;
  if (paperQ.isLoading) return <Skeleton />;
  if (paperQ.isError || !paper) return <ErrorState error={paperQ.error} onRetry={() => paperQ.refetch()} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{paper.paper_title}</Text>
      <Text style={styles.sub}>{[paper.class_name, paper.subject_name].filter(Boolean).join('  ·  ')}  ·  {questions.length} questions</Text>
      {allQ.data ? <Text style={styles.sub}>{enteredCount(allQ.data)} of {students.length} students entered</Text> : null}
      {questions.length === 0 ? <EmptyState title="No questions" message="This paper has no questions to mark yet." /> : (
        <>
          <Select label="Student" value={studentId} searchable placeholder={studentsQ.isLoading ? 'Loading...' : 'Choose a student'}
            options={students.map((s) => ({ value: s.id, label: `${s.roll_number ? `${s.roll_number}. ` : ''}${s.name}` }))}
            onChange={(v) => setStudentId(Number(v))} />
          <View style={styles.row}>
            <View style={styles.flex}><Button title="‹ Previous" size="sm" variant="ghost" disabled={idx <= 0} onPress={() => setStudentId(students[idx - 1].id)} /></View>
            <View style={styles.flex}><Button title="Next ›" size="sm" variant="ghost" disabled={idx < 0 || idx >= students.length - 1} onPress={() => setStudentId(students[idx + 1].id)} /></View>
          </View>
          {savedQ.isLoading ? <Skeleton variant="list" /> : questions.map((q, i) => {
            const d = drafts[q.question] ?? emptyDraft();
            const max = questionMarks(q);
            return (
              <Card key={q.id} style={styles.card}>
                <Text style={styles.qText}>Q{i + 1}. {plainQuestion(q.question_text)}</Text>
                {q.correct_answer ? <Text style={styles.sub}>Answer: {plainQuestion(q.correct_answer)}</Text> : null}
                <Input label="Student's answer (optional)" value={d.text} multiline onChangeText={(t) => edit(q.question, { text: t })} />
                <Input label={`Marks${max != null ? ` (out of ${Number(max)})` : ''}`} value={d.marks} keyboardType="decimal-pad" onChangeText={(t) => edit(q.question, { marks: t })} />
                <View style={styles.choices} accessibilityRole="radiogroup">
                  {CORRECT.map((c) => {
                    const on = d.correct === c.value;
                    return (
                      <TouchableOpacity key={String(c.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Question ${i + 1}: ${c.label}`}
                        onPress={() => edit(q.question, { correct: c.value })} style={[styles.choice, on && styles.choiceOn]}>
                        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Card>
            );
          })}
          <Button title="Save answers" onPress={save} loading={busy} disabled={busy || !studentId} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  card: { gap: 4 },
  qText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  choices: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  choice: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, minHeight: 40, justifyContent: 'center' },
  choiceOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  choiceText: { fontSize: FontSize.sm, color: Colors.text },
  choiceTextOn: { color: Colors.textInverse, fontWeight: '700' },
});
