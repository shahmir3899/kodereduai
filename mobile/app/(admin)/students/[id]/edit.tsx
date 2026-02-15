import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { studentsApi } from '../../../../services/api';
import Button from '../../../../components/ui/Button';
import Spinner from '../../../../components/ui/Spinner';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<StudentData>({
    id: 0, name: '', email: '', phone: '', guardian_name: '',
    guardian_phone: '', address: '', date_of_birth: '',
  });

  useEffect(() => {
    const fetchStudent = async () => {
      try {
        const response = await studentsApi.getStudent(Number(id));
        const s = response.data;
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
      } catch (error) {
        console.error('Failed to fetch student:', error);
        Alert.alert('Error', 'Failed to load student data.');
      } finally {
        setLoading(false);
      }
    };
    fetchStudent();
  }, [id]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('Required', 'Student name is required.');
      return;
    }
    setSaving(true);
    try {
      await studentsApi.updateStudent(Number(id), {
        name: form.name.trim(),
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        guardian_name: form.guardian_name?.trim() || undefined,
        guardian_phone: form.guardian_phone?.trim() || undefined,
        address: form.address?.trim() || undefined,
        date_of_birth: form.date_of_birth?.trim() || undefined,
      });
      Alert.alert('Success', 'Student profile updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Failed to update student:', error);
      Alert.alert('Error', 'Failed to update student profile.');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof StudentData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

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
        <Button title="Save Changes" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
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
