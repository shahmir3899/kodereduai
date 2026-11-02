import { dateSheetFileName, timetableFileName, timetablePdfParams } from '../services/pdfDownloads';

describe('file names', () => {
  it('keeps names file-system safe', () => {
    expect(dateSheetFileName('Mid Term / 2026')).toBe('DateSheet_Mid_Term_2026.pdf');
    expect(timetableFileName('Grade 1 - A')).toBe('Timetable_Grade_1_-_A.pdf');
  });

  it('falls back when the name is empty', () => {
    expect(dateSheetFileName('')).toBe('DateSheet_Exam.pdf');
    expect(timetableFileName('   ')).toBe('Timetable_Class.pdf');
  });
});

describe('timetablePdfParams', () => {
  it('needs a class, and adds the section when there is one', () => {
    expect(timetablePdfParams(null, 5)).toBeNull();
    expect(timetablePdfParams(4, null)).toEqual({ class_id: 4 });
    expect(timetablePdfParams(4, 9)).toEqual({ class_id: 4, session_class_id: 9 });
  });
});
