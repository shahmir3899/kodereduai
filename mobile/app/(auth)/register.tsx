import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { parentsApi } from '../../services/api';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export default function RegisterScreen() {
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    invite_code: '',
  });
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegister = async () => {
    if (!form.username || !form.password || !form.invite_code) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await parentsApi.register({
        username: form.username,
        email: form.email,
        password: form.password,
        phone: form.phone,
        invite_code: form.invite_code,
      });
      Alert.alert('Success', 'Registration successful! Please sign in.', [
        { text: 'OK', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (error: any) {
      const message =
        error.response?.data?.detail ||
        error.response?.data?.error ||
        JSON.stringify(error.response?.data) ||
        'Registration failed. Please try again.';
      Alert.alert('Registration Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Register as a parent or student using your invite code
          </Text>

          <Input
            label="Invite Code *"
            placeholder="Enter invite code from school"
            value={form.invite_code}
            onChangeText={(v) => updateField('invite_code', v)}
            autoCapitalize="none"
          />

          <Input
            label="Username *"
            placeholder="Choose a username"
            value={form.username}
            onChangeText={(v) => updateField('username', v)}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Input
            label="Email"
            placeholder="Your email address"
            value={form.email}
            onChangeText={(v) => updateField('email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Input
            label="Phone"
            placeholder="Phone number"
            value={form.phone}
            onChangeText={(v) => updateField('phone', v)}
            keyboardType="phone-pad"
          />

          <Input
            label="Password *"
            placeholder="Create a password"
            value={form.password}
            onChangeText={(v) => updateField('password', v)}
            secureTextEntry
            autoCapitalize="none"
          />

          <Input
            label="Confirm Password *"
            placeholder="Confirm your password"
            value={form.confirmPassword}
            onChangeText={(v) => updateField('confirmPassword', v)}
            secureTextEntry
            autoCapitalize="none"
          />

          <Button
            title="Register"
            onPress={handleRegister}
            loading={loading}
            fullWidth
            size="lg"
          />

          <Button
            title="Already have an account? Sign In"
            onPress={() => router.replace('/(auth)/login')}
            variant="ghost"
            fullWidth
            style={{ marginTop: Spacing.md }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  form: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xxl,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xxl,
    lineHeight: 20,
  },
});
