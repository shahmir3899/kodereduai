import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { studentPortalApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface ExamResult {
  id: number;
  exam_name: string;
  exam_type: string;
  subject_name: string;
  marks_obtained: number;
  total_marks: number;
  grade?: string;
  percentage: number;
}

export default function MyResults() {
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchResults = async () => {
    try {
      const response = await studentPortalApi.getExamResults();
      const data = response.data;
      setResults(data.results || data || []);
    } catch (error) {
      console.error('Failed to fetch results:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchResults();
  };

  // Group by exam
  const grouped = results.reduce<Record<string, ExamResult[]>>((acc, r) => {
    if (!acc[r.exam_name]) acc[r.exam_name] = [];
    acc[r.exam_name].push(r);
    return acc;
  }, {});

  if (loading) return <Spinner fullScreen message="Loading results..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>My Results</Text>

      {results.length === 0 ? (
        <EmptyState title="No Results" message="No exam results are available yet." />
      ) : (
        Object.entries(grouped).map(([examName, examResults]) => {
          const totalObtained = examResults.reduce((s, r) => s + r.marks_obtained, 0);
          const totalMax = examResults.reduce((s, r) => s + r.total_marks, 0);
          const pct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;

          return (
            <View key={examName} style={styles.examSection}>
              <View style={styles.examHeader}>
                <Text style={styles.examName}>{examName}</Text>
                <Text style={[styles.examPct, { color: pct >= 50 ? Colors.success : Colors.error }]}>
                  {pct}%
                </Text>
              </View>

              {examResults.map((r, idx) => (
                <Card key={r.id || idx} style={styles.resultCard}>
                  <View style={styles.resultRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subjectName}>{r.subject_name}</Text>
                      <Text style={styles.marksText}>
                        {r.marks_obtained} / {r.total_marks}
                      </Text>
                    </View>
                    <View style={styles.resultRight}>
                      {r.grade && (
                        <Badge
                          label={r.grade}
                          variant={r.percentage >= 50 ? 'success' : 'error'}
                        />
                      )}
                      <Text style={[
                        styles.pctText,
                        { color: r.percentage >= 50 ? Colors.success : Colors.error },
                      ]}>
                        {r.percentage}%
                      </Text>
                    </View>
                  </View>
                  <View style={styles.progressBar}>
                    <View style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(r.percentage, 100)}%`,
                        backgroundColor: r.percentage >= 75 ? Colors.success : r.percentage >= 50 ? Colors.warning : Colors.error,
                      },
                    ]} />
                  </View>
                </Card>
              ))}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{totalObtained} / {totalMax}</Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  examSection: { marginBottom: Spacing.xxl },
  examHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  examName: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  examPct: { fontSize: FontSize.lg, fontWeight: '700' },
  resultCard: { marginBottom: Spacing.sm },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  subjectName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  marksText: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  resultRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pctText: { fontSize: FontSize.md, fontWeight: '700' },
  progressBar: { height: 4, backgroundColor: Colors.surfaceSecondary, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.md, marginTop: Spacing.sm },
  totalLabel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  totalValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
});
