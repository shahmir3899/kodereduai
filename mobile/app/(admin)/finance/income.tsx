import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { financeApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

const INCOME_SOURCES = [
  'Donation',
  'Rent',
  'Event',
  'Government Grant',
  'Sponsorship',
  'Interest',
  'Other',
];

export default function RecordIncome() {
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const resetForm = () => {
    setSource('');
    setAmount('');
    setDescription('');
    setDate('');
  };

  const onRefresh = () => {
    setRefreshing(true);
    resetForm();
    setRefreshing(false);
  };

  const handleSubmit = async () => {
    if (!source) {
      Alert.alert('Missing Field', 'Please select an income source.');
      return;
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Missing Field', 'Please enter a description.');
      return;
    }
    if (!date.trim()) {
      Alert.alert('Missing Field', 'Please enter a date.');
      return;
    }

    setSubmitting(true);
    try {
      await financeApi.createOtherIncome({
        source,
        amount: parseFloat(amount),
        description: description.trim(),
        date: date.trim(),
      });
      Alert.alert('Success', 'Income recorded successfully.');
      resetForm();
    } catch (error) {
      console.error('Failed to create income:', error);
      Alert.alert('Error', 'Failed to record income. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>Record Income</Text>

        <Card style={styles.formCard}>
          {/* Source */}
          <Text style={styles.label}>Source</Text>
          <View style={styles.chipRow}>
            {INCOME_SOURCES.map((src) => (
              <TouchableOpacity
                key={src}
                style={[styles.chip, source === src && styles.chipSelected]}
                onPress={() => setSource(src)}
              >
                <Text
                  style={[
                    styles.chipText,
                    source === src && styles.chipTextSelected,
                  ]}
                >
                  {src}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Amount */}
          <Text style={styles.label}>Amount (PKR)</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter amount..."
            placeholderTextColor={Colors.placeholder}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter description..."
            placeholderTextColor={Colors.placeholder}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          {/* Date */}
          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.placeholder}
            value={date}
            onChangeText={setDate}
          />

          {/* Submit */}
          <Button
            title="Record Income"
            onPress={handleSubmit}
            loading={submitting}
            fullWidth
            style={styles.submitButton}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  formCard: {
    marginBottom: Spacing.xxl,
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
  submitButton: {
    marginTop: Spacing.xxl,
  },
});
