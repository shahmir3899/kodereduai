import {
  emptyPaperForm, isLockedStatus, paperFileName, paperToForm, paperTone, validateSetup, type PaperForm,
} from '../services/paperBuilder';

// Paper details only since Paper Builder v2 Phase 7: the questions are the block list (blockPaper.test.ts).
const base: PaperForm = { ...emptyPaperForm(), title: 'Mid Term', classObj: 5, subject: 4 };

describe('paper details', () => {
  it('names the PDF and colours the status', () => {
    expect(paperFileName('Physics Mid-Term 2026')).toBe('Physics_Mid_Term_2026.pdf');
    expect(paperFileName('')).toBe('Paper.pdf');
    expect(['DRAFT', 'READY', 'PUBLISHED'].map(paperTone)).toEqual(['neutral', 'info', 'success']);
  });

  it('checks the Setup step on its own, including Total Marks', () => {
    expect(validateSetup(base)).toBeNull();
    expect(validateSetup({ ...base, title: ' ' })).toBe('Enter the paper title.');
    expect(validateSetup({ ...base, classObj: null })).toBe('Choose the class.');
    expect(validateSetup({ ...base, subject: null })).toBe('Choose the subject.');
    expect(validateSetup({ ...base, duration: '1.5' })).toBe('Duration must be a whole number of minutes.');
    expect(validateSetup({ ...base, totalMarks: '0' })).toBe('Total marks must be a number above zero.');
    expect(validateSetup({ ...base, totalMarks: 'abc' })).toBe('Total marks must be a number above zero.');
    expect(validateSetup({ ...base, totalMarks: '' })).toBeNull();
  });

  it('reads the saved Total Marks back into the form, defaulting to 100', () => {
    const p = { id: 1, paper_title: 'T', class_obj: 5, subject: 4, status: 'DRAFT', total_marks: 40 } as unknown as Parameters<typeof paperToForm>[0];
    expect(paperToForm(p).totalMarks).toBe('40');
    expect(paperToForm({ ...p, total_marks: null } as never).totalMarks).toBe('100');
  });

  it('locks any paper that is not a draft, as the web does', () => {
    expect(isLockedStatus('DRAFT')).toBe(false);
    expect(isLockedStatus(null)).toBe(false);
    expect(isLockedStatus(undefined)).toBe(false);
    expect(isLockedStatus('READY')).toBe(true);
    expect(isLockedStatus('PUBLISHED')).toBe(true);
  });
});
