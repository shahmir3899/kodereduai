import { unzipSync } from 'fflate';
import {
  BULK_CONFIRM_ABOVE, buildBulkZip, bulkFileNames, needsConfirm, progressText, resultText, safeName, zipFileName, type BulkStudent,
} from '../services/bulkReportCards';

const student = (id: number, name: string, roll: string | number | null = id): BulkStudent => ({ studentId: id, enrollmentId: id + 100, name, roll });
const pdf = (text: string) => ({ data: new TextEncoder().encode(`%PDF-1.4 ${text}`).buffer as ArrayBuffer });

describe('names', () => {
  it('makes file-system safe names with a fallback', () => {
    expect(safeName(' Ali Raza / Jr. ', 'x')).toBe('Ali_Raza_Jr.');
    expect(safeName(null, 'Student')).toBe('Student');
    expect(zipFileName('Grade 1 - A')).toBe('Report_Cards_Grade_1_-_A.zip');
    expect(zipFileName('')).toBe('Report_Cards_Class.zip');
  });

  it('names each file roll_name and numbers a repeat so nothing is overwritten', () => {
    const list = [student(1, 'Ali Raza', '1'), student(2, 'Sara Khan', '2'), student(3, 'Ali Raza', '1'), student(4, 'No Roll', null)];
    expect(bulkFileNames(list)).toEqual(['1_Ali_Raza.pdf', '2_Sara_Khan.pdf', '1_Ali_Raza_2.pdf', '4_No_Roll.pdf']);
  });

  it('asks first only for a big class', () => {
    expect(needsConfirm(BULK_CONFIRM_ABOVE)).toBe(false);
    expect(needsConfirm(BULK_CONFIRM_ABOVE + 1)).toBe(true);
  });
});

describe('buildBulkZip', () => {
  it('packs every PDF into a ZIP that reads back, and reports progress', async () => {
    const progress: Array<[number, number]> = [];
    const { zip, result } = await buildBulkZip({
      students: [student(1, 'Ali'), student(2, 'Sara')],
      fetchPdf: async (s) => pdf(s.name),
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(result).toEqual({ generated: 2, skipped: [], cancelled: false });
    const files = unzipSync(zip as Uint8Array);
    expect(Object.keys(files).sort()).toEqual(['1_Ali.pdf', '2_Sara.pdf']);
    expect(new TextDecoder().decode(files['2_Sara.pdf'])).toContain('Sara');
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });

  it('skips a student the server refuses or answers with something that is not a PDF, and says why', async () => {
    const { zip, result } = await buildBulkZip({
      students: [student(1, 'Ali'), student(2, 'Sara'), student(3, 'Omar')],
      fetchPdf: async (s) => {
        if (s.studentId === 2) throw new Error('No marks for this student.');
        if (s.studentId === 3) return { data: new TextEncoder().encode('<html>error</html>').buffer as ArrayBuffer };
        return pdf(s.name);
      },
    });
    expect(result.generated).toBe(1);
    expect(result.skipped).toEqual([
      { name: 'Sara', reason: 'No marks for this student.' },
      { name: 'Omar', reason: 'The report card could not be made.' },
    ]);
    expect(Object.keys(unzipSync(zip as Uint8Array))).toEqual(['1_Ali.pdf']);
  });

  it('makes no ZIP when every student fails', async () => {
    const { zip, result } = await buildBulkZip({ students: [student(1, 'Ali')], fetchPdf: async () => { throw new Error('boom'); } });
    expect(zip).toBeNull();
    expect(result.generated).toBe(0);
    expect(resultText(result)).toBe('No report cards could be made.');
  });

  it('stops starting new students once cancelled and shares nothing', async () => {
    let calls = 0;
    let cancel = false;
    const { zip, result } = await buildBulkZip({
      students: [1, 2, 3, 4, 5, 6].map((i) => student(i, `S${i}`)),
      concurrency: 1,
      shouldCancel: () => cancel,
      fetchPdf: async (s) => { calls += 1; if (s.studentId === 2) cancel = true; return pdf(s.name); },
    });
    expect(calls).toBe(2);
    expect(zip).toBeNull();
    expect(result.cancelled).toBe(true);
    expect(resultText(result)).toBe('Cancelled. Nothing was shared.');
  });

  it('never has more requests in flight than the limit', async () => {
    let running = 0;
    let peak = 0;
    await buildBulkZip({
      students: Array.from({ length: 10 }, (_, i) => student(i + 1, `S${i}`)),
      concurrency: 3,
      fetchPdf: async (s) => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 2)); running -= 1; return pdf(s.name); },
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('text', () => {
  it('describes progress and the result', () => {
    expect(progressText(12, 30)).toBe('Making report cards: 12 of 30');
    expect(resultText({ generated: 1, skipped: [], cancelled: false })).toBe('Made 1 report card.');
    expect(resultText({ generated: 28, skipped: [{ name: 'a', reason: 'b' }, { name: 'c', reason: 'd' }], cancelled: false })).toBe('Made 28 report cards, 2 skipped.');
  });
});
