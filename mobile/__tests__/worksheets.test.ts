import {
  detailsFromWorksheet, detailsPayload, buildEnsurePayload, emptyNewWorksheet, isDraft, validateNewWorksheet, worksheetFileName, worksheetTone,
} from '../services/worksheets';

describe('new worksheet', () => {
  it('needs a class and sends the web payload', () => {
    expect(validateNewWorksheet(emptyNewWorksheet())).toMatch(/class/);
    expect(validateNewWorksheet({ title: '', classObj: 5, subject: null })).toMatch(/subject/);
    expect(validateNewWorksheet({ title: '', classObj: 5, subject: 3 })).toBeNull();
    expect(buildEnsurePayload({ title: ' Fractions ', classObj: 5, subject: 3 })).toEqual({ class_obj: 5, subject: 3, title: 'Fractions', source: 'MANUAL' });
    expect(buildEnsurePayload({ title: ' ', classObj: 5, subject: null })).toEqual({ class_obj: 5, subject: undefined, title: 'Untitled Worksheet', source: 'MANUAL' });
  });
});

describe('status and files', () => {
  it('knows drafts and tones', () => {
    expect(isDraft({ status: 'DRAFT' })).toBe(true);
    expect(isDraft({ status: 'READY' })).toBe(false);
    expect(worksheetTone('PUBLISHED')).toBe('success');
    expect(worksheetTone('DRAFT')).toBe('neutral');
  });
  it('names the files', () => {
    expect(worksheetFileName('Fractions: Practice!', 'pdf')).toBe('Fractions_Practice.pdf');
    expect(worksheetFileName('', 'docx')).toBe('Worksheet.docx');
  });
});

describe('block worksheet details (Phase 6b)', () => {
  it('saves title, instructions and a chosen subject only', () => {
    const d = detailsFromWorksheet({ id: 1, title: 'Sheet', class_obj: 2, status: 'DRAFT', instructions: undefined, subject: null });
    expect(d).toEqual({ title: 'Sheet', instructions: '', subject: null });
    expect(detailsPayload({ ...d, title: '  ' })).toEqual({ title: 'Untitled Worksheet', instructions: '' });
    expect(detailsPayload({ ...d, subject: 4 })).toEqual({ title: 'Sheet', instructions: '', subject: 4 });
  });
});
