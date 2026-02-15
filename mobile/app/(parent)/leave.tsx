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
import { parentsApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface LeaveRequest {
  id: number;
  student_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  created_at: string;
  admin_remarks?: string;
}

interface Child {
  id: number;
  name: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  APPROVED: 'success',
  REJECTED: 'error',
  PENDING: 'warning',
  CANCELLED: 'default',
};

export default function LeaveRequests() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [children, setChildren] = useState<Child[]>([]);

  // Form state
  const [selectedChild, setSelectedChild] = useState<number | null>(null);
  const [leaveType, setLeaveType] = useState('SICK');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const fetchData = async () => {
    try {
      const [leavesRes, childrenRes] = await Promise.all([
        parentsApi.getLeaveRequests(),
        parentsApi.getMyChildren(),
      ]);
      setRequests(leavesRes.data.results || leavesRes.data || []);
      const childrenData = childrenRes.data.children || childrenRes.data || [];
      setChildren(childrenData);
      if (childrenData.length > 0 && !selectedChild) {
        setSelectedChild(childrenData[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch leave requests:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleSubmit = async () => {
    if (!selectedChild || !startDate || !endDate || !reason.trim()) {
      Alert.alert('Missing Fields', 'Please fill in all required fields.');
      return;
    }

    setSubmitting(true);
    try {
      await parentsApi.createLeaveRequest({
        student: selectedChild,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim(),
      });
      Alert.alert('Success', 'Leave request submitted successfully.');
      setShowForm(false);
      setReason('');
      setStartDate('');
      setEndDate('');
      fetchData();
    } catch (error) {
      console.error('Failed to submit leave request:', error);
      Alert.alert('Error', 'Failed to submit leave request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    Alert.alert('Cancel Request', 'Are you sure you want to cancel this leave request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await parentsApi.cancelLeaveRequest(id);
            fetchData();
          } catch (error) {
            console.error('Failed to cancel leave request:', error);
            Alert.alert('Error', 'Failed to cancel leave request.');
          }
        },
      },
    ]);
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>Leave Requests</Text>
        <Button
          title={showForm ? 'Cancel' : 'New Request'}
          variant={showForm ? 'outline' : 'primary'}
          size="sm"
          onPress={() => setShowForm(!showForm)}
        />
      </View>

      {/* New Request Form */}
      {showForm && (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>New Leave Request</Text>

          {/* Child Selector */}
          <Text style={styles.label}>Student</Text>
          <View style={styles.chipRow}>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={[
                  styles.chip,
                  selectedChild === child.id && styles.chipSelected,
                ]}
                onPress={() => setSelectedChild(child.id)}
              >
                <Text style={[
                  styles.chipText,
                  selectedChild === child.id && styles.chipTextSelected,
                ]}>
                  {child.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Leave Type */}
          <Text style={styles.label}>Leave Type</Text>
          <View style={styles.chipRow}>
            {['SICK', 'CASUAL', 'EMERGENCY', 'OTHER'].map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, leaveType === type && styles.chipSelected]}
                onPress={() => setLeaveType(type)}
              >
                <Text style={[
                  styles.chipText,
                  leaveType === type && styles.chipTextSelected,
                ]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Dates */}
          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={styles.label}>Start Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.placeholder}
                value={startDate}
                onChangeText={setStartDate}
              />
            </View>
            <View style={styles.dateField}>
              <Text style={styles.label}>End Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.placeholder}
                value={endDate}
                onChangeText={setEndDate}
              />
            </View>
          </View>

          {/* Reason */}
          <Text style={styles.label}>Reason</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter reason for leave..."
            placeholderTextColor={Colors.placeholder}
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
          />

          <Button
            title="Submit Request"
            onPress={handleSubmit}
            loading={submitting}
            style={{ marginTop: Spacing.md }}
          />
        </Card>
      )}

      {/* Leave Request List */}
      {requests.length === 0 ? (
        <EmptyState
          title="No Leave Requests"
          message="You haven't submitted any leave requests yet."
        />
      ) : (
        requests.map((request) => (
          <Card key={request.id} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <View>
                <Text style={styles.requestStudent}>{request.student_name}</Text>
                <Text style={styles.requestType}>{request.leave_type} Leave</Text>
              </View>
              <Badge
                label={request.status}
                variant={STATUS_VARIANTS[request.status] || 'default'}
              />
            </View>

            <View style={styles.requestDates}>
              <Text style={styles.dateText}>
                {request.start_date} to {request.end_date}
              </Text>
            </View>

            <Text style={styles.reasonText}>{request.reason}</Text>

            {request.admin_remarks && (
              <View style={styles.remarksBox}>
                <Text style={styles.remarksLabel}>Admin Remarks:</Text>
                <Text style={styles.remarksText}>{request.admin_remarks}</Text>
              </View>
            )}

            {request.status === 'PENDING' && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => handleCancel(request.id)}
              >
                <Text style={styles.cancelText}>Cancel Request</Text>
              </TouchableOpacity>
            )}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  formCard: {
    marginBottom: Spacing.xxl,
  },
  formTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  chipTextSelected: {
    color: Colors.textInverse,
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  dateField: {
    flex: 1,
  },
  input: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  requestCard: {
    marginBottom: Spacing.md,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  requestStudent: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  requestType: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  requestDates: {
    marginBottom: Spacing.sm,
  },
  dateText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '500',
  },
  reasonText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  remarksBox: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  remarksLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 4,
  },
  remarksText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  cancelButton: {
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: FontSize.sm,
    color: Colors.error,
    fontWeight: '600',
  },
});
