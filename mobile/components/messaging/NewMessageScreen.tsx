import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useMessageActions, useRecipients } from '../../hooks/useMessaging';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { canSend, recipientKey, recipientLabel } from '../../services/messaging';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { Colors, Spacing } from '../../constants/colors';
import { saveFailureMessage } from '../../services/errorKind';

// A new conversation. The server decides who a role may write to (Manager: admins and
// principals); this only shows that list.
export default function NewMessageScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const recipients = useRecipients();
  const { create } = useMessageActions();
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  if (recipients.isLoading) return <Skeleton />;
  if (recipients.isError) return <ErrorState error={recipients.error} onRetry={() => recipients.refetch()} />;
  const list = recipients.data ?? [];
  if (list.length === 0) return <EmptyState title="No one to message" message="There is nobody you can message in this school." />;

  const send = () => {
    const person = list.find((r) => recipientKey(r) === to);
    if (!person || !canSend(body, person.id, true)) return;
    // The API checks the person against the child, so both ids go up together.
    create.mutateAsync({
      recipient_user_id: person.id,
      message: body.trim(),
      ...(person.student_id ? { student_id: person.student_id } : {}),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
    })
      .then((res) => {
        const id = (res.data as { id?: string } | undefined)?.id;
        toast.success('Message sent.');
        if (id) router.replace({ pathname: `${base}/messages/thread`, params: { id } } as Href);
        else router.back();
      })
      .catch((e: any) => toast.error(e?.response ? e?.response?.data?.detail || e?.response?.data?.error || 'Could not send the message.' : saveFailureMessage(e)));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Select label="To" value={to} searchable placeholder="Choose a person"
        options={list.map((r) => ({ value: recipientKey(r), label: recipientLabel(r) }))}
        onChange={setTo} />
      <Input label="Subject (optional)" value={subject} onChangeText={setSubject} />
      <Input label="Message" value={body} onChangeText={setBody} multiline numberOfLines={5} style={{ minHeight: 110, textAlignVertical: 'top' }} />
      <Button title="Send" onPress={send} loading={create.isPending} disabled={!canSend(body, to ? 1 : null, true)} fullWidth size="lg" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
});
