import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSavedSchool } from '../../hooks/useSchoolFinder';
import { useAuth } from '../../contexts/AuthContext';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { loginErrorMessage } from '../../services/sessionRules';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, sessionExpired } = useAuth();
  const router = useRouter();
  // The school picked on the front screen: its logo and name head the page. Without one (or when it
  // cannot be loaded) the page shows the app's own brand and signing in still works.
  const saved = useSavedSchool();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both username and password.');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      // The index route picks the home screen from the active school's role.
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Login Failed', loginErrorMessage(error));
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
        {/* Header */}
        <View style={styles.header}>
          {saved.school?.logo ? (
            <Image source={{ uri: saved.school.logo }} style={styles.schoolLogo} resizeMode="contain" accessibilityLabel={`${saved.school.name} logo`} />
          ) : (
            <Image source={require('../../assets/icon.png')} style={styles.schoolLogo} accessibilityLabel="Education AI" />
          )}
          <Text style={styles.appName}>{saved.school?.name ?? 'Education AI'}</Text>
          <Text style={styles.tagline}>{saved.school ? 'Powered by Education AI' : 'Smart School Management'}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(auth)/school' as Href)} style={styles.changeSchool}>
            <Text style={styles.changeSchoolText}>{saved.code ? 'Not your school? Change school' : 'Find your school'}</Text>
          </TouchableOpacity>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
          {sessionExpired && (
            <Text style={styles.expiredNote} accessibilityRole="alert">
              Your session has expired. Please sign in again.
            </Text>
          )}

          <Input
            label="Username"
            placeholder="Enter your username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            rightIcon={
              <Text style={styles.showHide}>
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            }
            onRightIconPress={() => setShowPassword(!showPassword)}
          />

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/forgot-password')}
            style={styles.forgotLink}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            fullWidth
            size="lg"
          />

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/register')}
            style={styles.registerLink}
          >
            <Text style={styles.registerText}>
              Don't have an account?{' '}
              <Text style={styles.registerTextBold}>Register</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  schoolLogo: { width: 88, height: 88, borderRadius: BorderRadius.lg, marginBottom: Spacing.sm },
  changeSchool: { minHeight: 44, justifyContent: 'center', marginTop: Spacing.sm },
  changeSchoolText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.textInverse,
  },
  appName: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
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
  },
  expiredNote: {
    fontSize: FontSize.sm,
    color: Colors.warning,
    marginTop: -Spacing.lg,
    marginBottom: Spacing.lg,
  },
  showHide: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '600',
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginBottom: Spacing.lg,
  },
  forgotText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '600',
  },
  registerLink: {
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  registerText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  registerTextBold: {
    color: Colors.primary,
    fontWeight: '600',
  },
});
