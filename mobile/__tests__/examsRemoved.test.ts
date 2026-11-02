import { EXAM_FILTERS, examListParams, examShortcutParams, isRemoved, parseShortcut, reactivatePayload } from '../services/examsAdmin';

describe('exam list filter', () => {
  it('ends with Removed and asks the server for inactive exams only for it', () => {
    expect(EXAM_FILTERS[EXAM_FILTERS.length - 1]).toEqual({ value: 'REMOVED', label: 'Removed' });
    expect(examListParams('REMOVED')).toEqual({ is_active: false });
    expect(examListParams('MARKS_ENTRY')).toEqual({ status: 'MARKS_ENTRY' });
    expect(examListParams('')).toEqual({});
  });

  it('spots a removed exam and builds the reactivate payload', () => {
    expect(isRemoved({ is_active: false })).toBe(true);
    expect(isRemoved({ is_active: true })).toBe(false);
    expect(isRemoved({})).toBe(false);
    expect(reactivatePayload()).toEqual({ is_active: true });
  });
});

describe('examShortcutParams', () => {
  const options = [
    { id: 11, classObj: 4, isSession: true }, { id: 12, classObj: 4, isSession: true },
    { id: 21, classObj: 5, isSession: true }, { id: 7, classObj: null, isSession: false },
  ];
  const exam = (over: object) => ({ id: 90, class_obj: 4, exam_type: 3, session_class: null as number | null, ...over });

  it('picks the first section of a whole-class exam', () => {
    expect(examShortcutParams(exam({}), options)).toEqual({ class: '11', exam: '90', type: '3' });
  });

  it('picks the exam’s own section when it has one', () => {
    expect(examShortcutParams(exam({ session_class: 12 }), options)).toEqual({ class: '12', exam: '90', type: '3' });
  });

  it('falls back to the class itself when the year has no sections, and to nothing when the class is unknown', () => {
    expect(examShortcutParams(exam({ class_obj: 7 }), options)).toEqual({ class: '7', exam: '90', type: '3' });
    expect(examShortcutParams(exam({ class_obj: 99 }), options)).toBeNull();
  });
});

describe('parseShortcut', () => {
  it('reads numbers and ignores anything else', () => {
    expect(parseShortcut({ class: '11', exam: '90', type: '3' })).toEqual({ classId: 11, examId: 90, typeId: 3 });
    expect(parseShortcut({ class: 'abc', exam: '', type: '1x' })).toEqual({ classId: null, examId: null, typeId: null });
    expect(parseShortcut({})).toEqual({ classId: null, examId: null, typeId: null });
  });
});
