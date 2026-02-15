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
import { notificationsApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

const AUDIENCE_OPTIONS = ['All Parents', 'Specific Class', 'Individual'];
const CHANNEL_OPTIONS = ['PUSH', 'SMS', 'WHATSAPP'];

export default function SendNotification() {
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('All Parents');
  const [channels, setChannels] = useState<string[]>(['PUSH']);
  const [classId, setClassId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const toggleChannel = (channel: string) => {
    setChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : [...prev, channel]
    );
  };

  const resetForm = () => {
    setMessage('');
    setTitle('');
    setAudience('All Parents');
    setChannels(['PUSH']);
    setClassId('');
    setRecipientId('');
  };

  const onRefresh = () => {
    setRefreshing(true);
    resetForm();
    setRefreshing(false);
  };

  const handleSend = async () => {
    if (!title.trim()) {
      Alert.alert('Missing Field', 'Please enter a notification title.');
      return;
    }
    if (!message.trim()) {
      Alert.alert('Missing Field', 'Please enter a message.');
      return;
    }
    if (channels.length === 0) {
      Alert.alert('Missing Field', 'Please select at least one channel.');
      return;
    }
    if (audience === 'Specific Class' && !classId.trim()) {
      Alert.alert('Missing Field', 'Please enter a class ID.');
      return;
    }
    if (audience === 'Individual' && !recipientId.trim()) {
      Alert.alert('Missing Field', 'Please enter a recipient ID.');
      return;
    }

    setSubmitting(true);
    try {
      const data: Record<string, unknown> = {
        title: title.trim(),
        message: message.trim(),
        channels,
        audience_type: audience === 'All Parents' ? 'ALL' : audience === 'Specific Class' ? 'CLASS' : 'INDIVIDUAL',
      };

      if (audience === 'Specific Class') {
        data.class_id = Number(classId);
      }
      if (audience === 'Individual') {
        data.recipient_id = Number(recipientId);
      }

      await notificationsApi.send(data);
      Alert.alert('Success', 'Notification sent successfully.');
      resetForm();
    } catch (error) {
      console.error('Failed to send notification:', error);
      Alert.alert('Error', 'Failed to send notification. Please try again.');
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
        <Text style={styles.title}>Quick Send</Text>

        <Card style={styles.formCard}>
          {/* Title */}
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            placeholder="Notification title..."
            placeholderTextColor={Colors.placeholder}
            value={title}
            onChangeText={setTitle}
          />

          {/* Message */}
          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Type your message here..."
            placeholderTextColor={Colors.placeholder}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
          />

          {/* Audience */}
          <Text style={styles.label}>Audience</Text>
          <View style={styles.chipRow}>
            {AUDIENCE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, audience === option && styles.chipSelected]}
                onPress={() => setAudience(option)}
              >
                <Text
                  style={[
                    styles.chipText,
                    audience === option && styles.chipTextSelected,
                  ]}
                >
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Conditional fields based on audience */}
          {audience === 'Specific Class' && (
            <>
              <Text style={styles.label}>Class ID</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter class ID..."
                placeholderTextColor={Colors.placeholder}
                value={classId}
                onChangeText={setClassId}
                keyboardType="numeric"
              />
            </>
          )}

          {audience === 'Individual' && (
            <>
              <Text style={styles.label}>Recipient ID</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter recipient ID..."
                placeholderTextColor={Colors.placeholder}
                value={recipientId}
                onChangeText={setRecipientId}
                keyboardType="numeric"
              />
            </>
          )}

          {/* Channel */}
          <Text style={styles.label}>Channel</Text>
          <View style={styles.chipRow}>
            {CHANNEL_OPTIONS.map((channel) => {
              const isSelected = channels.includes(channel);
              return (
                <TouchableOpacity
                  key={channel}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => toggleChannel(channel)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {channel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Send Button */}
          <Button
            title="Send Notification"
            onPress={handleSend}
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
    minHeight: 100,
    textAlignVertical: 'top',
  },
  submitButton: {
    marginTop: Spacing.xxl,
  },
});
