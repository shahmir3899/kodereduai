import { buildDiaryPayloads, diaryResultText, filledEntries, uniqueSubjects, validateDiary } from '../services/dailyDiary';

describe('daily diary', () => {
  const subjects = uniqueSubjects([
    { subject: 1, subject_name: 'English', subject_code: 'ENG' },
    { subject: 2, subject_name: 'Math' },
    { subject: 1, subject_name: 'English' },
    { subject: 0, subject_name: 'Nothing' },
  ]);

  it('lists each subject once', () => {
    expect(subjects.map((s) => s.id)).toEqual([1, 2]);
    expect(subjects[0].code).toBe('ENG');
  });

  it('keeps only the subjects with text, trimmed, in list order', () => {
    const entries = filledEntries(subjects, { 2: '  Page 4  ', 1: '   ' });
    expect(entries).toEqual([{ subject: subjects[1], details: 'Page 4' }]);
  });

  it('asks for a class, a date and at least one subject', () => {
    expect(validateDiary(null, '2026-11-02', [1], 9)).toMatch(/class/);
    expect(validateDiary(5, '2026-11-02', [1], null)).toMatch(/teacher/);
    expect(validateDiary(5, '', [1], 9)).toMatch(/date/);
    expect(validateDiary(5, '2026-11-02', [], 9)).toMatch(/at least one/);
    expect(validateDiary(5, '2026-11-02', [1], 9)).toBeNull();
  });

  it('builds the draft payload with the teacher the server requires', () => {
    const [p] = buildDiaryPayloads({
      entries: [{ subject: subjects[1], details: 'Page 4' }], date: '2026-11-02', masterClassId: 7, sessionClassId: 46, teacherId: 12, academicYearId: 46,
    });
    expect(p).toEqual({
      class_obj: 7, session_class: 46, subject: 2, teacher: 12, title: 'Math Diary - 2026-11-02', description: 'Page 4', instructions: 'Page 4',
      assignment_type: 'DIARY', requires_submission: false, due_date: '2026-11-02', total_marks: 0, attachments_allowed: false,
      status: 'DRAFT', academic_year: 46,
    });
    expect(buildDiaryPayloads({ entries: [{ subject: subjects[0], details: 'x' }], date: '2026-11-02', masterClassId: 7, sessionClassId: null, teacherId: 12 })[0])
      .not.toHaveProperty('academic_year');
  });

  it('says what was saved and what was not', () => {
    expect(diaryResultText(['A'], [])).toBe('Daily diary saved as drafts for 1 subject.');
    expect(diaryResultText(['A', 'B'], [])).toMatch(/2 subjects/);
    expect(diaryResultText([], ['A'])).toMatch(/Could not save the diary for A/);
    expect(diaryResultText(['A'], ['B'])).toMatch(/Saved A\. Could not save B/);
  });
});
