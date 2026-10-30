// Pure helpers for exporting the server's report files. The files themselves are made by the
// server (POST /api/reports/generate-instant/ and the ledger exports), the same ones the web
// downloads, so a PDF is identical on both.

import type { DateRange } from './accountant';

export interface InstantReportRequest {
  report_type: 'FINANCE_SUMMARY' | 'FEE_COLLECTION' | 'FEE_DEFAULTERS';
  parameters: Record<string, unknown>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Same parameters the web Finance Dashboard sends.
export function financeSummaryRequest(range: DateRange, periodLabel: string, academicYearId?: number | null): InstantReportRequest {
  return {
    report_type: 'FINANCE_SUMMARY',
    parameters: {
      date_from: range.from,
      date_to: range.to,
      period_label: periodLabel,
      ...(academicYearId ? { academic_year: academicYearId } : {}),
    },
  };
}

export function feeReportRequest(
  type: 'FEE_COLLECTION' | 'FEE_DEFAULTERS', month: number, year: number, academicYearId?: number | null,
): InstantReportRequest {
  return {
    report_type: type,
    parameters: { month, year, ...(academicYearId ? { academic_year: academicYearId } : {}) },
  };
}

// File-system safe: letters, digits, dash and underscore only.
export function safeName(text: string): string {
  return (text || 'School').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'School';
}

export function financeSummaryFileName(school: string, range: DateRange): string {
  return `Finance_Report_${safeName(school)}_${range.from}_to_${range.to}.pdf`;
}

export function feeReportFileName(type: 'FEE_COLLECTION' | 'FEE_DEFAULTERS', month: number, year: number): string {
  const name = type === 'FEE_COLLECTION' ? 'Fee_Collection' : 'Fee_Defaulters';
  return `${name}_${MONTHS[month - 1]}_${year}.pdf`;
}

export function ledgerFileName(accountName: string, range: DateRange | null, ext: 'pdf' | 'xlsx'): string {
  const span = range ? `_${range.from}_to_${range.to}` : '';
  return `Ledger_${safeName(accountName)}${span}.${ext}`;
}

export const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

// A PDF starts with "%PDF"; an error page saved under a .pdf name would open as a broken file.
export function looksLikePdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}

// An Excel file is a zip: it starts with "PK".
export function looksLikeXlsx(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length > 2 && b[0] === 0x50 && b[1] === 0x4b;
}

// Error responses are asked for as bytes too, so read the JSON message out of them.
export function exportErrorMessage(error: unknown): string {
  const e = error as { response?: { status?: number; data?: ArrayBuffer | { error?: string; detail?: string } }; code?: string } | null;
  const status = e?.response?.status;
  if (!e?.response) return 'No connection. Connect to the internet and try again.';
  if (status === 403) return 'Your role cannot generate this report.';
  if (status === 404) return 'That account was not found.';
  const data = e.response.data;
  try {
    const parsed = data instanceof ArrayBuffer ? JSON.parse(new TextDecoder().decode(data)) : data;
    const message = (parsed as { error?: string; detail?: string } | undefined)?.error ?? (parsed as { detail?: string } | undefined)?.detail;
    if (message) return message;
  } catch {
    // Not JSON: fall through to the generic text.
  }
  return status && status >= 500 ? 'The server could not make the report. Try again in a moment.' : 'The report could not be created.';
}
