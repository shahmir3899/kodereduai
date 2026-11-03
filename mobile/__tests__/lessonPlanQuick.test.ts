import {
  autoTitle, buildPlanPayload, classOptionFor, emptyPlanForm, planToForm, QUICK_DURATION, quickForm, teacherFromAssignments, validateQuick,
  type LessonPlan, type LessonPlanForm,
} from '../services/lessonPlans';
import { topicNames, type BookChoice } from '../services/lessonPlanTools';
import { newRow } from '../services/lessonPlanObjectives';
import type { ClassOption } from '../services/attendanceEntry';

const secA: ClassOption = { id: 30, label: 'Grade 5 - A', classObj: 5, isSession: true };
const secB: ClassOption = { id: 31, label: 'Grade 5 - B', classObj: 5, isSession: true };
const master: ClassOption = { id: 5, label: 'Grade 5', classObj: null, isSession: false };

const ok = (over: Partial<LessonPlanForm> = {}): LessonPlanForm => ({
  ...emptyPlanForm('2026-11-03', 7), classOption: 30, subject: 2, topicIds: [11], ...over,
});

describe('autoTitle', () => {
  it('joins up to three picked topic names, then up to three typed ones on a new line', () => {
    expect(autoTitle(['Halves', 'Quarters', 'Thirds', 'Fifths'], [])).toBe('Halves, Quarters, Thirds');
    expect(autoTitle(['Halves'], ['My own topic'])).toBe('Halves\nMy own topic');
    expect(autoTitle([], ['a', 'b', 'c', 'd'])).toBe('a, b, c');
  });

  it('drops blanks and repeats, falls back, and stays within 200 letters', () => {
    expect(autoTitle([' ', 'Halves', 'Halves'], [' '])).toBe('Halves');
    expect(autoTitle([], [])).toBe('Lesson');
    expect(autoTitle([], [], 'Plan')).toBe('Plan');
    expect(autoTitle(['x'.repeat(300)], []).length).toBe(200);
  });
});

describe('the subject teacher', () => {
  const rows = [
    { subject: 2, teacher: null }, { subject: 2, teacher: 9, is_active: false }, { subject: 2, teacher: 12 }, { subject: 3, teacher: 4 },
  ];

  it('is the active row of that subject that names a teacher', () => {
    expect(teacherFromAssignments(rows, 2)).toBe(12);
    expect(teacherFromAssignments(rows, 3)).toBe(4);
  });

  it('is nothing when there is no subject, no row, or no teacher', () => {
    expect(teacherFromAssignments(rows, null)).toBeNull();
    expect(teacherFromAssignments(rows, 99)).toBeNull();
    expect(teacherFromAssignments([{ subject: 2, teacher: null }], 2)).toBeNull();
  });
});

describe('validateQuick', () => {
  it('passes with class, subject, teacher, date and a picked topic', () => {
    expect(validateQuick(ok())).toBeNull();
  });

  it('accepts a typed topic instead of a picked one', () => {
    expect(validateQuick(ok({ topicIds: [], topics: 'Halves' }))).toBeNull();
  });

  it('names what is missing, in order', () => {
    expect(validateQuick(ok({ classOption: null }))).toBe('Choose the class.');
    expect(validateQuick(ok({ subject: null }))).toBe('Choose the subject.');
    expect(validateQuick(ok({ teacher: null }))).toBe('No teacher is set for this class and subject. Choose one.');
    expect(validateQuick(ok({ date: '' }))).toBe('Choose the lesson date.');
    expect(validateQuick(ok({ topicIds: [], topics: ' \n ' }))).toBe('Pick a topic from the book or type one.');
  });

  it('does not ask for a title', () => {
    expect(validateQuick(ok({ title: '' }))).toBeNull();
  });
});

describe('quickForm', () => {
  it('makes a 45 minute unpublished draft with a title from the topics and nothing else filled in', () => {
    const f = quickForm(ok({ title: 'ignored', duration: '90', description: 'd', materials: 'm', methods: 't', objectives: 'o', published: true,
      objectiveRows: [newRow({ statement: 'x' })], topics: 'Mine' }), ['Halves']);
    expect(f).toMatchObject({ title: 'Halves\nMine', duration: QUICK_DURATION, description: '', materials: '', methods: '', objectives: '', published: false });
    expect(f.objectiveRows).toHaveLength(1);
    expect(f.objectiveRows[0].statement).toBe('');
  });

  it('builds a draft payload the server accepts', () => {
    const payload = buildPlanPayload(quickForm(ok(), ['Halves']), secA, { school: 1, academicYear: 3 });
    expect(payload).toMatchObject({
      title: 'Halves', duration_minutes: 45, status: 'DRAFT', objectives: '', description: '', materials_needed: '', teaching_methods: '',
      class_obj: 5, session_class: 30, subject: 2, teacher: 7, planned_topic_ids: [11], content_mode: 'TOPICS',
    });
  });

  it('keeps the form it was given unchanged', () => {
    const f = ok({ title: 'keep me' });
    quickForm(f, ['x']);
    expect(f.title).toBe('keep me');
  });
});

describe('topicNames', () => {
  const books: BookChoice[] = [{ id: 1, title: 'Maths', chapters: [
    { id: 1, title: 'Ch 1', topics: [{ id: 10, title: 'Halves' }, { id: 11, title: 'Quarters' }] },
    { id: 2, title: 'Ch 2', topics: [{ id: 20, title: 'Decimals' }] },
  ] }];

  it('lists the picked topics in book order', () => {
    expect(topicNames(books, [20, 10])).toEqual(['Halves', 'Decimals']);
    expect(topicNames(books, [])).toEqual([]);
    expect(topicNames([], [10])).toEqual([]);
  });
});

describe('opening a saved plan for editing: its class', () => {
  const plan = (over: Partial<LessonPlan> = {}): LessonPlan => ({
    id: 1, title: 'T', lesson_date: '2026-11-03', duration_minutes: 40, status: 'DRAFT', class_obj: 5, subject: 2, teacher: 7, ...over,
  });

  it('maps a section plan to its section, and a master-class plan to the master class', () => {
    expect(classOptionFor(plan({ session_class: 31 }), [secA, secB])).toBe(31);
    expect(classOptionFor(plan({ session_class: null }), [master])).toBe(5);
  });

  it('maps an old whole-class plan to the class\'s first section when the school lists sections only', () => {
    expect(classOptionFor(plan({ session_class: null }), [secA, secB])).toBe(30);
  });

  it('gives null, not a raw id, for a class that is not in the list', () => {
    expect(classOptionFor(plan({ session_class: 99 }), [secA])).toBeNull();
    expect(classOptionFor(plan({ session_class: null, class_obj: 8 }), [secA])).toBeNull();
    expect(planToForm(plan({ session_class: null, class_obj: 8 }), [secA]).classOption).toBeNull();
  });
});
