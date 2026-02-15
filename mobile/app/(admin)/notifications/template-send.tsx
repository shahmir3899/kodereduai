import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { notificationsApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Template {
  id: number;
  name: string;
  body: string;
  channel: string;
  variables?: string[];
}

const AUDIENCE_OPTIONS = ['All Parents', 'Specific Class', 'Individual'];

export default function SendFromTemplate() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [audience, setAudience] = useState('All Parents');
  const [classId, setClassId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchTemplates = async () => {
    try {
      const response = await notificationsApi.getTemplates();
      setTemplates(response.data.results || response.data || []);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      Alert.alert('Error', 'Failed to load templates.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTemplates();
  };

  const extractVariables = (body: string): string[] => {
    const matches = body.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
  };

  const openTemplate = (template: Template) => {
    setSelectedTemplate(template);
    const vars = template.variables || extractVariables(template.body);
    const initial: Record<string, string> = {};
    vars.forEach((v) => { initial[v] = ''; });
    setVariableValues(initial);
    setAudience('All Parents');
    setClassId('');
    setRecipientId('');
    setModalVisible(true);
  };

  const getPreviewBody = (): string => {
    if (!selectedTemplate) return '';
    let body = selectedTemplate.body;
    Object.entries(variableValues).forEach(([key, value]) => {
      body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || `{{${key}}}`);
    });
    return body;
  };

  const handleSend = async () => {
    if (!selectedTemplate) return;

    const vars = Object.keys(variableValues);
    const missingVars = vars.filter((v) => !variableValues[v].trim());
    if (missingVars.length > 0) {
      Alert.alert('Missing Variables', `Please fill in: ${missingVars.join(', ')}`);
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
        template_id: selectedTemplate.id,
        variables: variableValues,
        channels: [selectedTemplate.channel || 'PUSH'],
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
      setModalVisible(false);
      setSelectedTemplate(null);
    } catch (error) {
      console.error('Failed to send notification:', error);
      Alert.alert('Error', 'Failed to send notification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner fullScreen message="Loading templates..." />;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>Send from Template</Text>

        {templates.length === 0 ? (
          <EmptyState
            title="No Templates"
            message="No notification templates found."
            actionLabel="Refresh"
            onAction={onRefresh}
          />
        ) : (
          templates.map((template) => (
            <TouchableOpacity
              key={template.id}
              activeOpacity={0.7}
              onPress={() => openTemplate(template)}
            >
              <Card style={styles.templateCard}>
                <View style={styles.templateHeader}>
                  <Text style={styles.templateName}>{template.name}</Text>
                  {template.channel && (
                    <Badge label={template.channel} variant="info" />
                  )}
                </View>
                <Text style={styles.templateBody} numberOfLines={2}>
                  {template.body}
                </Text>
                {(template.variables || extractVariables(template.body)).length > 0 && (
                  <View style={styles.variableRow}>
                    {(template.variables || extractVariables(template.body)).map((v) => (
                      <View key={v} style={styles.variableTag}>
                        <Text style={styles.variableTagText}>{`{{${v}}}`}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Send Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>
                {selectedTemplate?.name || 'Template'}
              </Text>

              {/* Preview */}
              <Text style={styles.sectionLabel}>Preview</Text>
              <View style={styles.previewBox}>
                <Text style={styles.previewText}>{getPreviewBody()}</Text>
              </View>

              {/* Variables */}
              {Object.keys(variableValues).length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Variables</Text>
                  {Object.keys(variableValues).map((key) => (
                    <View key={key}>
                      <Text style={styles.varLabel}>{key}</Text>
                      <TextInput
                        style={styles.input}
                        placeholder={`Enter ${key}...`}
                        placeholderTextColor={Colors.placeholder}
                        value={variableValues[key]}
                        onChangeText={(text) =>
                          setVariableValues((prev) => ({ ...prev, [key]: text }))
                        }
                      />
                    </View>
                  ))}
                </>
              )}

              {/* Audience */}
              <Text style={styles.sectionLabel}>Audience</Text>
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

              {audience === 'Specific Class' && (
                <>
                  <Text style={styles.varLabel}>Class ID</Text>
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
                  <Text style={styles.varLabel}>Recipient ID</Text>
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

              {/* Buttons */}
              <View style={styles.modalButtons}>
                <Button
                  title="Cancel"
                  variant="outline"
                  onPress={() => setModalVisible(false)}
                  style={styles.modalButton}
                />
                <Button
                  title="Send"
                  onPress={handleSend}
                  loading={submitting}
                  style={styles.modalButton}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
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
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  templateCard: {
    marginBottom: Spacing.md,
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  templateName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: Spacing.sm,
  },
  templateBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  variableRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  variableTag: {
    backgroundColor: Colors.infoLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  variableTagText: {
    fontSize: FontSize.xs,
    color: Colors.info,
    fontWeight: '500',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  previewBox: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  previewText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  varLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
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
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xxl,
  },
  modalButton: {
    flex: 1,
  },
});
