import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MIME, looksLikePdf, looksLikeXlsx } from './reports';

// Native half of report export: write the server's bytes to the phone's cache and open the share
// sheet (save to Files/Drive, WhatsApp, email). Kept apart from reports.ts so that file stays pure
// and testable without native modules.
export async function shareReportFile(
  fetchBytes: () => Promise<{ data: ArrayBuffer }>,
  fileName: string,
  kind: 'pdf' | 'xlsx' | 'docx',
): Promise<void> {
  const { data } = await fetchBytes();
  const ok = kind === 'pdf' ? looksLikePdf(data) : looksLikeXlsx(data); // xlsx and docx are both zips
  if (!ok) throw new Error('The server did not return a valid file.');

  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(new Uint8Array(data));

  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(file.uri, { mimeType: MIME[kind], dialogTitle: fileName, UTI: kind === 'pdf' ? 'com.adobe.pdf' : undefined });
}

// Share a file that is already in memory (a ZIP built on the phone), through the same share sheet.
export async function shareFileBytes(bytes: Uint8Array, fileName: string, kind: 'zip'): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(bytes);

  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(file.uri, { mimeType: MIME[kind], dialogTitle: fileName });
}
