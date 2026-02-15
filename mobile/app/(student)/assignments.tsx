import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { studentPortalApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Assignment {
  id: number;
  title: string;
  description: string;
  subject_name: string;
  due_date: string;
  status: 'PENDING' | 'SUBMITTED' | 'GRADED' | 'LATE' | 'OVERDUE';
  marks_obtained?: number;
  total_marks?: number;
  submission_text?: string;
  feedback?: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  SUBMITTED: 'success',
  GRADED: 'success',
  PENDING: 'warning',
  LATE: 'error',
  OVERDUE: 'error',
};

export default function MyAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAssignments = async () => {
    try {
      const response = await studentPortalApi.getAssignments();
      const data = response.data;
      setAssignments(data.results || data.assignments || data || []);
    } catch (error) {
      console.error('Failed to fetch assignments:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAssignments();
  };

  const handleSubmit = async (assignmentId: number) => {
    if (!submissionText.trim()) {
      Alert.alert('Required', 'Please enter your submission text.');
      return;
    }

    setSubmitting(true);
    try {
      await studentPortalApi.submitAssignment(assignmentId, {
        submission_text: submissionText.trim(),
      });
      Alert.alert('Success', 'Assignment submitted successfully!');
      setSelectedId(null);
      setSubmissionText('');
      fetchAssignments();
    } catch (error) {
      console.error('Failed to submit assignment:', error);
      Alert.alert('Error', 'Failed to submit assignment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner fullScreen message="Loading assignments..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>My Assignments</Text>

      {assignments.length === 0 ? (
        <EmptyState title="No Assignments" message="No assignments have been posted yet." />
      ) : (
        assignments.map((assignment) => (
          <Card key={assignment.id} style={styles.assignmentCard}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.assignmentTitle}>{assignment.title}</Text>
                <Text style={styles.subjectText}>{assignment.subject_name}</Text>
              </View>
              <Badge
                label={assignment.status}
                variant={STATUS_VARIANTS[assignment.status] || 'default'}
              />
            </View>

            <Text style={styles.description} numberOfLines={3}>
              {assignment.description}
            </Text>

            <View style={styles.metaRow}>
              <Text style={styles.dueDate}>Due: {assignment.due_date}</Text>
              {assignment.total_marks && (
                <Text style={styles.marksInfo}>
                  {assignment.marks_obtained !== undefined
                    ? `${assignment.marks_obtained}/${assignment.total_marks}`
                    : `${assignment.total_marks} marks`}
                </Text>
              )}
            </View>

            {/* Feedback */}
            {assignment.feedback && (
              <View style={styles.feedbackBox}>
                <Text style={styles.feedbackLabel}>Feedback:</Text>
                <Text style={styles.feedbackText}>{assignment.feedback}</Text>
              </View>
            )}

            {/* Submit button */}
            {assignment.status === 'PENDING' && (
              <>
                {selectedId === assignment.id ? (
                  <View style={styles.submitForm}>
                    <TextInput
                      style={styles.textArea}
                      placeholder="Enter your submission..."
                      placeholderTextColor={Colors.placeholder}
                      value={submissionText}
                      onChangeText={setSubmissionText}
                      multiline
                      numberOfLines={4}
                    />
                    <View style={styles.submitActions}>
                      <Button
                        title="Cancel"
                        variant="outline"
                        size="sm"
                        onPress={() => {
                          setSelectedId(null);
                          setSubmissionText('');
                        }}
                      />
                      <Button
                        title="Submit"
                        size="sm"
                        loading={submitting}
                        onPress={() => handleSubmit(assignment.id)}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.submitButton}
                    onPress={() => setSelectedId(assignment.id)}
                  >
                    <Text style={styles.submitButtonText}>Submit Assignment</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  assignmentCard: { marginBottom: Spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.sm },
  assignmentTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  subjectText: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  description: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dueDate: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '500' },
  marksInfo: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  feedbackBox: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.md, marginTop: Spacing.sm },
  feedbackLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  feedbackText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  submitButton: { marginTop: Spacing.md, backgroundColor: Colors.primary, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, alignItems: 'center' },
  submitButtonText: { color: Colors.textInverse, fontWeight: '600', fontSize: FontSize.sm },
  submitForm: { marginTop: Spacing.md },
  textArea: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, borderWidth: 1, borderColor: Colors.border, minHeight: 80, textAlignVertical: 'top', marginBottom: Spacing.sm },
  submitActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
});
