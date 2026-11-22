import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { examinationsApi } from './api';
import { htmlToPdf } from './htmlPdf';
import { shareReportFile } from './reportShare';
import { paperFileName } from './paperBuilder';
import { answerKeyFileName } from './blockPaper';
import { docxFileName } from './questionExtras';
import type { DocKind } from './blockPaper';

// Native half of printing a block paper (Paper Builder v2, decision 2026-11-15: the PDF is made on the device).
// The server sends the saved paper as one HTML page with the library pictures inside it (print-html?embed=1),
// because Android's expo-print can make the PDF before linked pictures have loaded. Urdu shaping and the
// page layout are the phone's WebView's, as they are the browser's on the web.

// kind: 'paper' or 'worksheet' (Phase 6b: worksheets are printed the same way).
async function paperHtml(paperId: number, kind: DocKind = 'paper'): Promise<string> {
  const { data } = await (kind === 'worksheet' ? examinationsApi.getWorksheetPrintHtml(paperId, true) : examinationsApi.getPaperPrintHtml(paperId, true));
  return String(data);
}

// The browser preview of the app (Expo web) has no expo-print: print from an off-screen frame, as the web app does.
function printInBrowser(html: string): void {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '210mm', height: '297mm', border: '0' });
  frame.onload = () => setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  }, 600);
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

/** Make the PDF on the phone and open the share sheet (save to Files, WhatsApp, email). */
export async function sharePaperPdf(paperId: number, title: string, kind: DocKind = 'paper'): Promise<void> {
  const html = await paperHtml(paperId, kind);
  if (Platform.OS === 'web') return printInBrowser(html);
  await shareReportFile(() => htmlToPdf(html), paperFileName(title), 'pdf');
}

/** The phone's own print dialog (a printer, or "Save as PDF"). */
export async function printPaper(paperId: number, kind: DocKind = 'paper'): Promise<void> {
  const html = await paperHtml(paperId, kind);
  if (Platform.OS === 'web') return printInBrowser(html);
  await Print.printAsync({ html });
}

/** The answer key (step 7b), made into a PDF on the phone like the paper and shared. */
export async function shareAnswerKey(paperId: number, title: string, kind: DocKind = 'paper'): Promise<void> {
  const { data } = await (kind === 'worksheet' ? examinationsApi.getWorksheetAnswerKeyHtml(paperId) : examinationsApi.getPaperAnswerKeyHtml(paperId));
  const html = String(data);
  if (Platform.OS === 'web') return printInBrowser(html);
  await shareReportFile(() => htmlToPdf(html), answerKeyFileName(title), 'pdf');
}

/** The server's Word file for the paper, through the share sheet (same file the web downloads). */
export async function sharePaperWord(paperId: number, title: string, kind: DocKind = 'paper'): Promise<void> {
  await shareReportFile(() => (kind === 'worksheet' ? examinationsApi.generateWorksheetDocx(paperId) : examinationsApi.generatePaperDocx(paperId)),
    docxFileName(title), 'docx');
}
