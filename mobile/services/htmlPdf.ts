import * as Print from 'expo-print';
import { File } from 'expo-file-system';

// Native half of every PDF drawn on the phone: expo-print turns an HTML page into a PDF file, and
// the bytes go to the same share sheet as the server's exports. Kept apart from the HTML builders
// (reportCardHtml.ts, lessonPlansHtml.ts) so those stay pure and testable without native modules.
export async function htmlToPdf(html: string): Promise<{ data: ArrayBuffer }> {
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4 in points
  const file = new File(uri);
  try {
    const base64 = await file.base64();
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { data: bytes.buffer as ArrayBuffer };
  } finally {
    try { file.delete(); } catch { /* the cache is cleared by the system anyway */ }
  }
}
