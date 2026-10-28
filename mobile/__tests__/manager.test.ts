import {
  academicsGroups, bookRow, calendarItems, chaptersOf, monthTitle, notificationsOf, paperRow,
  questionRow, shiftMonth, timetableEntriesOf, worksheetRow,
} from '../services/manager';
import type { NavGroup } from '../navigation/navConfig';

describe('timetableEntriesOf', () => {
  it('reads the by_class payload', () => {
    expect(timetableEntriesOf({ grid: {}, entries: [{ id: 1 }] })).toEqual([{ id: 1 }]);
  });
  it('accepts a bare or paginated list and tolerates junk', () => {
    expect(timetableEntriesOf([{ id: 2 }])).toEqual([{ id: 2 }]);
    expect(timetableEntriesOf({ results: [{ id: 3 }] })).toEqual([{ id: 3 }]);
    expect(timetableEntriesOf(null)).toEqual([]);
  });
});

describe('academicsGroups', () => {
  const g = (name: string): NavGroup => ({ name, items: [] });
  it('keeps only academics-type groups, in web order', () => {
    const out = academicsGroups([g('General'), g('Management'), g('My HR'), g('Academics'), g('Content Creation')]);
    expect(out.map((x) => x.name)).toEqual(['Academics', 'Content Creation', 'Management']);
  });
});

describe('content rows', () => {
  it('shortens long question text and joins the details', () => {
    const r = questionRow({ id: 1, question_text: 'x'.repeat(200), subject_name: 'Math', question_type: 'MCQ', marks: 2, difficulty_level: 'EASY' });
    expect(r.title.length).toBeLessThanOrEqual(90);
    expect(r.subtitle).toBe('Math  ·  Mcq  ·  2 marks');
    expect(r.pill).toBe('Easy');
  });
  it('falls back to a title when missing', () => {
    expect(paperRow({ id: 1 }).title).toBe('Untitled paper');
    expect(worksheetRow({ id: 1 }).title).toBe('Untitled worksheet');
    expect(bookRow({ id: 1 }).title).toBe('Book');
  });
  it('describes a paper', () => {
    expect(paperRow({ id: 1, paper_title: 'Mid', class_name: '5-A', subject_name: 'Urdu', total_marks: 50, status: 'PUBLISHED' }))
      .toMatchObject({ title: 'Mid', subtitle: '5-A  ·  Urdu  ·  50 marks', pill: 'Published' });
  });
});

describe('chaptersOf', () => {
  it('orders by chapter number', () => {
    const out = chaptersOf({ chapters: [{ id: 2, title: 'B', chapter_number: 2 }, { id: 1, title: 'A', chapter_number: 1 }] });
    expect(out.map((c) => c.id)).toEqual([1, 2]);
  });
  it('is empty for nothing', () => expect(chaptersOf(undefined)).toEqual([]));
});

describe('calendarItems', () => {
  it('skips plain Sundays and quiet days, keeps events and holidays', () => {
    const items = calendarItems([
      { date: '2026-10-04', is_off_day: true, off_day_types: ['SUNDAY'], entries: [] },
      { date: '2026-10-05', is_off_day: false, entries: [] },
      { date: '2026-10-06', is_off_day: false, entries: [{ id: 1, name: 'Sports day' }] },
      { date: '2026-10-07', is_off_day: true, off_day_types: ['HOLIDAY'], entries: [{ id: 2, name: 'Iqbal Day' }] },
    ]);
    expect(items).toEqual([
      { date: '2026-10-06', names: ['Sports day'], off: false },
      { date: '2026-10-07', names: ['Iqbal Day'], off: true },
    ]);
  });
  it('keeps a Sunday that also has an event', () => {
    expect(calendarItems([{ date: '2026-10-11', is_off_day: true, off_day_types: ['SUNDAY'], entries: [{ id: 1, name: 'Fair' }] }])).toHaveLength(1);
  });
});

describe('months', () => {
  it('shifts across year ends', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
  });
  it('titles a month', () => expect(monthTitle(2026, 10)).toContain('2026'));
});

describe('notificationsOf', () => {
  it('handles page, wrapped and bare lists', () => {
    expect(notificationsOf({ results: [{ id: 1 }] })).toHaveLength(1);
    expect(notificationsOf({ notifications: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(notificationsOf([{ id: 1 }])).toHaveLength(1);
    expect(notificationsOf(undefined)).toEqual([]);
  });
});
