import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authApi } from '../../services/api';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter the email on your account.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await authApi.requestPasswordReset(trimmed);
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => router.replace('/(auth)/login');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          {submitted ? (
            <>
              <Text style={styles.title}>Check your email</Text>
              {/* Same wording whether or not the email exists: the API never reveals that. */}
              <Text style={styles.body}>
                If an account exists for this email, a password reset link has been sent. Open the
                link on this phone to choose a new password.
              </Text>
              <Button title="Back to sign in" onPress={backToLogin} fullWidth size="lg" />
            </>
          ) : (
            <>
              <Text style={styles.title}>Forgot password</Text>
              <Text style={styles.body}>
                Enter the email on your account and we will send you a link to reset your password.
              </Text>
              <Input
                label="Email address"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                error={error || undefined}
              />
              <Button title="Send reset link" onPress={handleSubmit} loading={loading} fullWidth size="lg" />
              <Text style={styles.hint}>
                No email on your account? Ask your school to reset your password for you.
              </Text>
              <TouchableOpacity onPress={backToLogin} style={styles.backLink}>
                <Text style={styles.backText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xxl },
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
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  body: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xl },
  hint: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.lg, textAlign: 'center' },
  backLink: { marginTop: Spacing.lg, alignItems: 'center' },
  backText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
});
