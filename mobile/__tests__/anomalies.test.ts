import {
  STATE_FILTERS, TYPE_FILTERS, anomalyParams, anomalySubject, anomalyTitle, resolveErrorMessage, resolvePayload, resolvedLine,
  severityLabel, severityTone,
} from '../services/anomalies';

describe('anomalyParams', () => {
  it('asks for open or resolved, and a type only when one is chosen', () => {
    expect(anomalyParams('open', '')).toEqual({ is_resolved: false, page_size: 50 });
    expect(anomalyParams('resolved', 'CLASS_BULK')).toEqual({ is_resolved: true, page_size: 50, anomaly_type: 'CLASS_BULK' });
  });

  it('opens on Open and offers the three server types', () => {
    expect(STATE_FILTERS[0].value).toBe('open');
    expect(TYPE_FILTERS.map((t) => t.value)).toEqual(['', 'CLASS_BULK', 'STUDENT_PATTERN', 'UNUSUAL_DAY']);
  });
});

describe('text', () => {
  it('maps severity to a tone and a label', () => {
    expect(severityTone('HIGH')).toBe('error');
    expect(severityTone('MEDIUM')).toBe('warning');
    expect(severityTone('LOW')).toBe('info');
    expect(severityLabel('HIGH')).toBe('High');
  });

  it('titles by type and says who it is about', () => {
    expect(anomalyTitle({ anomaly_type: 'CLASS_BULK' })).toBe('Bulk class absence');
    expect(anomalyTitle({ anomaly_type: 'NEW_ONE' })).toBe('NEW_ONE');
    expect(anomalySubject({ student_name: 'Ali', class_name: 'Grade 1' })).toBe('Ali  ·  Grade 1');
    expect(anomalySubject({ class_name: 'Grade 1' })).toBe('Grade 1');
    expect(anomalySubject({})).toBe('');
  });

  it('describes a resolved item', () => {
    expect(resolvedLine({ resolved_by_name: 'Qaisar', resolved_at: '2026-11-01T09:00:00Z', resolution_notes: 'Rain' })).toBe('Resolved by Qaisar  ·  2026-11-01  ·  Rain');
    expect(resolvedLine({})).toBe('Resolved');
  });
});

describe('resolve', () => {
  it('sends the trimmed note as notes', () => {
    expect(resolvePayload('  was a holiday  ')).toEqual({ notes: 'was a holiday' });
  });

  it('explains an already resolved item and falls back otherwise', () => {
    expect(resolveErrorMessage({ response: { data: { error: 'Already resolved' } } })).toBe('Someone already resolved this one.');
    expect(resolveErrorMessage({ response: { data: { detail: 'Not allowed.' } } })).toBe('Not allowed.');
    expect(resolveErrorMessage(new Error('x'))).toBe('Could not resolve it.');
  });
});

import { hubLine } from '../services/anomalies';
import { registerFileName, registerPdfParams } from '../services/pdfDownloads';

describe('hubLine', () => {
  it('says how many are not marked, and stays silent when it does not know', () => {
    expect(hubLine.today(null)).toBeNull();
    expect(hubLine.today({})).toBeNull();
    expect(hubLine.today({ is_off_day: true, total_students: 10 })).toBe('Today is an off day');
    expect(hubLine.today({ not_marked_count: 0, total_students: 10 })).toBe('Everyone is marked today');
    expect(hubLine.today({ not_marked_count: 1, total_students: 10 })).toBe('1 student not marked today');
    expect(hubLine.today({ not_marked_count: 4, total_students: 10 })).toBe('4 students not marked today');
  });

  it('says how many anomalies are open', () => {
    expect(hubLine.anomalies(undefined)).toBeNull();
    expect(hubLine.anomalies(0)).toBe('Nothing to review');
    expect(hubLine.anomalies(3)).toBe('3 to review');
  });
});

describe('register PDF', () => {
  it('sends the section and its class, or just the class, with month, year and the academic year', () => {
    expect(registerPdfParams({ id: 9, classObj: 4, isSession: true }, 2026, 11, 46)).toEqual({ session_class_id: 9, class_id: 4, month: 11, year: 2026, academic_year: 46 });
    expect(registerPdfParams({ id: 4, classObj: null, isSession: false }, 2026, 11, null)).toEqual({ class_id: 4, month: 11, year: 2026 });
    expect(registerPdfParams(null, 2026, 11, 46)).toBeNull();
  });

  it('names the file by class and month', () => {
    expect(registerFileName('Grade 1 - A', 2026, 11)).toBe('Attendance_Grade_1_-_A_2026-11.pdf');
  });
});
