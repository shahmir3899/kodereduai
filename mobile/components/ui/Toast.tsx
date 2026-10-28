import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type ToastKind = 'success' | 'error' | 'info';
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const BG: Record<ToastKind, string> = { success: Colors.success, error: Colors.error, info: Colors.primary };

// Non-blocking feedback for saves and failures, in place of Alert.alert (which blocks and
// needs a tap). Use confirm() for questions that need an answer.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
    }, 3000);
  }, [opacity]);

  const api = useRef<ToastApi>({
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
  }).current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { backgroundColor: BG[toast.kind], opacity }]}>
          <Text style={styles.text}>{toast.message}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 80,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  text: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: '600', textAlign: 'center' },
});
