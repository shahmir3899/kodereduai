import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { studentsApi } from '../../../../services/api';
import Button from '../../../../components/ui/Button';
import ErrorState from '../../../../components/ui/ErrorState';
import Skeleton from '../../../../components/ui/Skeleton';
import { useToast } from '../../../../components/ui/Toast';
import { useScopedQuery } from '../../../../hooks/useScopedQuery';
import { saveFailureMessage } from '../../../../services/errorKind';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../../constants/colors';

interface StudentData {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  guardian_name?: string;
  guardian_phone?: string;
  address?: string;
  date_of_birth?: string;
}

export default function EditStudent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<StudentData>({
    id: 0, name: '', email: '', phone: '', guardian_name: '',
    guardian_phone: '', address: '', date_of_birth: '',
  });

  // A failed load must not leave an empty form that could be saved over the real record.
  const query = useScopedQuery('student-edit', [id], async () => (await studentsApi.getStudent(Number(id))).data);
  useEffect(() => {
    const s = query.data;
    if (!s) return;
    setForm({
      id: s.id,
      name: s.name || '',
      email: s.email || '',
      phone: s.phone || '',
      guardian_name: s.guardian_name || '',
      guardian_phone: s.guardian_phone || '',
      address: s.address || '',
      date_of_birth: s.date_of_birth || '',
    });
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => studentsApi.updateStudent(Number(id), {
      name: form.name.trim(),
      email: form.email?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      guardian_name: form.guardian_name?.trim() || undefined,
      guardian_phone: form.guardian_phone?.trim() || undefined,
      address: form.address?.trim() || undefined,
      date_of_birth: form.date_of_birth?.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Student profile updated.');
      qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit'].includes(q.queryKey[0] as string) });
      router.back();
    },
    onError: (e) => toast.error(saveFailureMessage(e, 'Could not update the student profile.')),
  });

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Student name is required.'); return; }
    save.mutate();
  };

  const updateField = (field: keyof StudentData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (query.isLoading) return <Skeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Edit Student</Text>
      <FormField label="Name *" value={form.name} onChangeText={(v) => updateField('name', v)} />
      <FormField label="Email" value={form.email} onChangeText={(v) => updateField('email', v)} keyboardType="email-address" />
      <FormField label="Phone" value={form.phone} onChangeText={(v) => updateField('phone', v)} keyboardType="phone-pad" />
      <FormField label="Guardian Name" value={form.guardian_name} onChangeText={(v) => updateField('guardian_name', v)} />
      <FormField label="Guardian Phone" value={form.guardian_phone} onChangeText={(v) => updateField('guardian_phone', v)} keyboardType="phone-pad" />
      <FormField label="Date of Birth" value={form.date_of_birth} onChangeText={(v) => updateField('date_of_birth', v)} placeholder="YYYY-MM-DD" />
      <FormField label="Address" value={form.address} onChangeText={(v) => updateField('address', v)} multiline />
      <View style={styles.actions}>
        <Button title="Cancel" variant="outline" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button title="Save Changes" onPress={handleSave} loading={save.isPending} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

function FormField({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value?: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'email-address' | 'phone-pad'; multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textArea]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={Colors.placeholder}
        keyboardType={keyboardType}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xxl },
  field: { marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderRadius: BorderRadius.sm, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
});
