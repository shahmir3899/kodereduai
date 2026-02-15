import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { parentsApi } from '../../../../services/api';
import Card from '../../../../components/ui/Card';
import Badge from '../../../../components/ui/Badge';
import Spinner from '../../../../components/ui/Spinner';
import EmptyState from '../../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../../constants/colors';

interface ExamResult {
  id: number;
  exam_name: string;
  exam_type: string;
  subject_name: string;
  marks_obtained: number;
  total_marks: number;
  grade?: string;
  percentage: number;
  term?: string;
}

interface GroupedResults {
  [exam: string]: ExamResult[];
}

export default function ChildResults() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchResults = async () => {
    try {
      const response = await parentsApi.getChildExamResults(Number(id));
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
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchResults();
  };

  // Group results by exam name
  const grouped = results.reduce<GroupedResults>((acc, result) => {
    const key = result.exam_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(result);
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
      <Text style={styles.title}>Exam Results</Text>

      {results.length === 0 ? (
        <EmptyState
          title="No Results"
          message="No exam results are available yet."
        />
      ) : (
        Object.entries(grouped).map(([examName, examResults]) => {
          const totalObtained = examResults.reduce((sum, r) => sum + r.marks_obtained, 0);
          const totalMax = examResults.reduce((sum, r) => sum + r.total_marks, 0);
          const overallPercentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;

          return (
            <View key={examName} style={styles.examSection}>
              {/* Exam Header */}
              <View style={styles.examHeader}>
                <View>
                  <Text style={styles.examName}>{examName}</Text>
                  <Text style={styles.examType}>
                    {examResults[0]?.exam_type || 'Exam'}
                  </Text>
                </View>
                <View style={styles.overallBadge}>
                  <Text style={[
                    styles.overallText,
                    { color: overallPercentage >= 50 ? Colors.success : Colors.error },
                  ]}>
                    {overallPercentage}%
                  </Text>
                </View>
              </View>

              {/* Subject Rows */}
              {examResults.map((result) => (
                <Card key={result.id || `${result.subject_name}-${result.exam_name}`} style={styles.resultCard}>
                  <View style={styles.resultRow}>
                    <View style={styles.resultInfo}>
                      <Text style={styles.subjectName}>{result.subject_name}</Text>
                      <Text style={styles.marksText}>
                        {result.marks_obtained} / {result.total_marks}
                      </Text>
                    </View>
                    <View style={styles.resultRight}>
                      {result.grade && (
                        <Badge
                          label={result.grade}
                          variant={getGradeVariant(result.grade)}
                        />
                      )}
                      <Text style={[
                        styles.percentText,
                        { color: result.percentage >= 50 ? Colors.success : Colors.error },
                      ]}>
                        {result.percentage}%
                      </Text>
                    </View>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(result.percentage, 100)}%`,
                          backgroundColor: result.percentage >= 75
                            ? Colors.success
                            : result.percentage >= 50
                              ? Colors.warning
                              : Colors.error,
                        },
                      ]}
                    />
                  </View>
                </Card>
              ))}

              {/* Total Row */}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>
                  {totalObtained} / {totalMax}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function getGradeVariant(grade: string): 'success' | 'warning' | 'error' | 'default' {
  const g = grade.toUpperCase();
  if (g === 'A+' || g === 'A' || g === 'A-') return 'success';
  if (g === 'B+' || g === 'B' || g === 'B-') return 'success';
  if (g === 'C+' || g === 'C' || g === 'C-') return 'warning';
  if (g === 'D' || g === 'D+' || g === 'D-') return 'warning';
  if (g === 'F') return 'error';
  return 'default';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  examSection: {
    marginBottom: Spacing.xxl,
  },
  examHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  examName: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  examType: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  overallBadge: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  overallText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  resultCard: {
    marginBottom: Spacing.sm,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  resultInfo: {
    flex: 1,
  },
  subjectName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  marksText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  resultRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  percentText: {
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  totalLabel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  totalValue: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.primary,
  },
});
