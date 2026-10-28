import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { authApi } from '../../services/api';
import { passwordProblem } from '../../services/password';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Colors, Spacing } from '../../constants/colors';

// Self-service password change for any signed-in role (needs the current password).
export default function ChangePasswordScreen() {
  const router = useRouter();
  const toast = useToast();
  const [oldPassword, setOld] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const problem = passwordProblem(oldPassword, next, confirm);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      await authApi.changePassword({ old_password: oldPassword, new_password: next, confirm_password: confirm });
      toast.success('Password changed.');
      router.back();
    } catch (e: any) {
      const data = e?.response?.data;
      const first = data && typeof data === 'object' ? Object.values(data).flat()[0] : null;
      toast.error(typeof first === 'string' ? first : data?.detail || 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Input label="Current password" value={oldPassword} onChangeText={setOld} secureTextEntry autoCapitalize="none" />
      <Input label="New password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
      <Input label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
      <Button title="Change password" onPress={save} loading={busy} fullWidth size="lg" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
});
