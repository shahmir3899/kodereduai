import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Colors, BorderRadius, FontSize, Spacing } from '../../constants/colors';

// Web build only: when the browser autofills a saved username or password it paints the text part of
// the box light blue, which stopped short of the eye icon. Keep autofilled boxes the same white as
// the rest of the box (added once to the page).
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('input-autofill-style')) {
  const tag = document.createElement('style');
  tag.id = 'input-autofill-style';
  tag.textContent = `input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
    -webkit-box-shadow: 0 0 0 1000px ${Colors.surface} inset !important;
    -webkit-text-fill-color: ${Colors.text} !important;
    transition: background-color 9999s ease-out 0s;
  }`;
  document.head.appendChild(tag);
}

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
  // Spoken name of the right-hand button when it is an icon only (e.g. "Show password").
  rightIconLabel?: string;
}

export default function Input({
  label,
  error,
  icon,
  rightIcon,
  onRightIconPress,
  rightIconLabel,
  style,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          focused && styles.focused,
          error && styles.errorBorder,
        ]}
      >
        {icon && <View style={styles.iconLeft}>{icon}</View>}
        <TextInput
          style={[styles.input, style]}
          accessibilityLabel={label ?? props.placeholder}
          placeholderTextColor={Colors.placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {rightIcon && (
          <TouchableOpacity onPress={onRightIconPress} style={styles.iconRight} accessibilityRole="button" accessibilityLabel={rightIconLabel} hitSlop={8}>
            {rightIcon}
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
  },
  // The whole box (icons included) shows focus. On the web the browser drew its own outline round
  // the text part only, cut off before the eye icon, so that one is switched off below and the
  // box gets a soft ring instead.
  focused: {
    borderColor: Colors.primary,
    ...Platform.select({ web: { boxShadow: `0 0 0 3px ${Colors.infoLight}` } as object, default: {} }),
  },
  errorBorder: {
    borderColor: Colors.error,
  },
  iconLeft: {
    paddingLeft: Spacing.md,
  },
  iconRight: {
    paddingRight: Spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
  error: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
});
