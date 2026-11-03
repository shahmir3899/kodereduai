import { renderReportCardHtml, type CardReport, type CardSchool } from './reportCardHtml';
import { htmlToPdf } from './htmlPdf';
import type { ReportTemplate } from './reportCard';
import { schoolToday } from './schoolTime';

// Native half of the report card PDF: the HTML page is drawn by reportCardHtml.ts and turned into a
// PDF file on the phone by htmlToPdf, then shared like every other export.
export async function makeReportCardPdf(
  report: CardReport, school: CardSchool | null | undefined, template: ReportTemplate,
): Promise<{ data: ArrayBuffer }> {
  return htmlToPdf(renderReportCardHtml({ report, school, template, today: schoolToday() }));
}
