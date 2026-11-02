import * as Print from 'expo-print';
import { File } from 'expo-file-system';
import { renderReportCardHtml, type CardReport, type CardSchool } from './reportCardHtml';
import type { ReportTemplate } from './reportCard';
import { schoolToday } from './schoolTime';

// Native half of the report card PDF: expo-print turns the HTML page into a PDF file on the phone,
// and the bytes go to the same share sheet as every other export. Kept apart from reportCardHtml.ts
// so that file stays pure and testable without native modules.
export async function makeReportCardPdf(
  report: CardReport, school: CardSchool | null | undefined, template: ReportTemplate,
): Promise<{ data: ArrayBuffer }> {
  const html = renderReportCardHtml({ report, school, template, today: schoolToday() });
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
