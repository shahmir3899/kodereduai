import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { documentFileProblem } from '../../services/hrAdmin';

export interface PickedFile { uri: string; name: string; type: string }
export type PickResult = { file: PickedFile } | { error: string } | null;

// A photo (camera or gallery, with the phone's own crop so the page fills the picture) or a PDF /
// Word file. Same limits as the server: JPG, PNG, WEBP, PDF, DOC, DOCX, 10 MB. null = cancelled.
export async function pickDocumentFile(source: 'camera' | 'gallery' | 'file'): Promise<PickResult> {
  if (source === 'file') {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const a = result.assets[0];
    const bad = documentFileProblem(a.mimeType, a.size);
    if (bad) return { error: bad };
    return { file: { uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' } };
  }
  const camera = source === 'camera';
  const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { error: camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.' };
  const opts = { quality: 0.7, allowsEditing: true } as const;
  const result = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, mediaTypes: ['images'] });
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  const type = a.mimeType ?? 'image/jpeg';
  const bad = documentFileProblem(type, a.fileSize);
  if (bad) return { error: bad };
  return { file: { uri: a.uri, name: a.fileName ?? 'document.jpg', type } };
}
