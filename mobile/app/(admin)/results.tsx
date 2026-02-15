import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { examinationsApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Exam { id: number; name: string; exam_type: string; date?: string; status?: string; }
interface ExamResult { student_name: string; marks_obtained: number; total_marks: number; percentage: number; grade?: string; }

export default function ExamResults() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExam, setSelectedExam] = useState<number | null>(null);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const fetchExams = async () => {
      try {
        const response = await examinationsApi.getExams();
        const data = response.data.results || response.data || [];
        setExams(data);
      } catch (error) { console.error('Failed to fetch exams:', error); }
      finally { setLoading(false); }
    };
    fetchExams();
  }, []);

  const fetchResults = async (examId: number) => {
    setSelectedExam(examId);
    try {
      const response = await examinationsApi.getExamResults(examId);
      setResults(response.data.results || response.data || []);
    } catch (error) { console.error('Failed to fetch results:', error); }
  };

  const onRefresh = () => { setRefreshing(true); setRefreshing(false); };

  if (loading) return <Spinner fullScreen message="Loading exams..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Exam Results</Text>

      {exams.length === 0 ? (
        <EmptyState title="No Exams" message="No exams have been created yet." />
      ) : !selectedExam ? (
        exams.map((exam) => (
          <TouchableOpacity key={exam.id} onPress={() => fetchResults(exam.id)}>
            <Card style={styles.examCard}>
              <View style={styles.examRow}>
                <View>
                  <Text style={styles.examName}>{exam.name}</Text>
                  <Text style={styles.examType}>{exam.exam_type}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      ) : (
        <View>
          <TouchableOpacity onPress={() => { setSelectedExam(null); setResults([]); }}>
            <Text style={styles.backText}>‹ Back to Exams</Text>
          </TouchableOpacity>
          <Text style={styles.subTitle}>
            {exams.find((e) => e.id === selectedExam)?.name || 'Results'}
          </Text>
          {results.length === 0 ? (
            <EmptyState title="No Results" message="No results available for this exam." />
          ) : (
            results.map((r, idx) => (
              <Card key={idx} style={styles.resultCard}>
                <View style={styles.resultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName}>{r.student_name}</Text>
                    <Text style={styles.marks}>{r.marks_obtained}/{r.total_marks}</Text>
                  </View>
                  {r.grade && <Badge label={r.grade} variant={r.percentage >= 50 ? 'success' : 'error'} />}
                  <Text style={[styles.pct, { color: r.percentage >= 50 ? Colors.success : Colors.error }]}>
                    {r.percentage}%
                  </Text>
                </View>
              </Card>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  subTitle: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },
  backText: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '600', marginBottom: Spacing.lg },
  examCard: { marginBottom: Spacing.sm },
  examRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  examName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  examType: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: Colors.textTertiary },
  resultCard: { marginBottom: Spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  studentName: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  marks: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  pct: { fontSize: FontSize.md, fontWeight: '700', minWidth: 45, textAlign: 'right' },
});
