import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

// Promise wrapper around Alert so screens can `if (!(await confirm({...}))) return;`.
// react-native-web's Alert.alert does nothing, so in a browser (the Expo web preview) the page's own confirm box is used;
// without it the promise would never settle and the screen would stall.
export function confirm({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(message ? `${title}\n\n${message}` : title)
      : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
