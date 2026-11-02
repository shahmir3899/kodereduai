import { Platform } from 'react-native';

// Adds a picked file to a FormData. On a phone React Native reads { uri, name, type } itself; a browser needs the real bytes,
// so on the web the file is fetched into a Blob first (this is what lets the app be tried in a browser).
export async function appendFile(form: FormData, field: string, file: { uri: string; name: string; type: string }): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, new File([blob], file.name, { type: file.type || blob.type }));
    return;
  }
  form.append(field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
}
