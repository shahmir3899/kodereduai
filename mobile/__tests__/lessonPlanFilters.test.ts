import {
  activeFilterCount, bulkDeleteResultText, bulkDeleteText, bulkPublishResultText, bulkPublishText, canPublish, draftIdsOf,
  emptyFilters, filterParams, filterProblem,
} from '../services/lessonPlans';
import type { ClassOption } from '../services/attendanceEntry';

const options: ClassOption[] = [
  { id: 11, label: 'Grade 5 - A', classObj: 5, isSession: true },
  { id: 5, label: 'Grade 5', classObj: null, isSession: false },
];

describe('lesson plan filters', () => {
  it('sends nothing when no filter is set', () => {
    expect(filterParams(emptyFilters(), options)).toEqual({});
    expect(activeFilterCount(emptyFilters())).toBe(0);
  });

  it('sends a section as its master class plus its own id, and a whole class by id', () => {
    expect(filterParams({ ...emptyFilters(), classOption: 11 }, options)).toEqual({ class_id: 5, session_class_id: 11 });
    expect(filterParams({ ...emptyFilters(), classOption: 5 }, options)).toEqual({ class_id: 5 });
  });

  it('sends the subject and either end of the date range', () => {
    expect(filterParams({ classOption: null, subject: 9, from: '2026-11-01', to: '' }, options)).toEqual({ subject_id: 9, date_from: '2026-11-01' });
    expect(filterParams({ classOption: null, subject: null, from: '', to: '2026-11-30' }, options)).toEqual({ date_to: '2026-11-30' });
  });

  it('ignores a class it does not know, and drops an invalid date range', () => {
    expect(filterParams({ ...emptyFilters(), classOption: 99 }, options)).toEqual({});
    expect(filterParams({ classOption: null, subject: 3, from: '2026-12-01', to: '2026-11-01' }, options)).toEqual({ subject_id: 3 });
  });

  it('explains a bad range', () => {
    expect(filterProblem(emptyFilters())).toBeNull();
    expect(filterProblem({ ...emptyFilters(), from: '2026-11-01', to: '2026-11-01' })).toBeNull();
    expect(filterProblem({ ...emptyFilters(), from: '2026-12-01', to: '2026-11-01' })).toBe('From must not be after To.');
    expect(filterProblem({ ...emptyFilters(), from: 'nonsense' })).toBe('Choose a valid From date.');
    expect(filterProblem({ ...emptyFilters(), to: '11/2026' })).toBe('Choose a valid To date.');
  });

  it('counts the filters in use', () => {
    expect(activeFilterCount({ classOption: 11, subject: 9, from: '2026-11-01', to: '' })).toBe(3);
    expect(activeFilterCount({ classOption: 0 as unknown as number, subject: null, from: '', to: '' })).toBe(1);
  });
});

describe('lesson plan bulk actions', () => {
  const rows = [
    { id: 1, status: 'DRAFT' }, { id: 2, status: 'PUBLISHED' }, { id: 3, status: 'DRAFT' },
  ];

  it('publishes drafts only, and only the selected ones', () => {
    expect(draftIdsOf(rows, [1, 2])).toEqual([1]);
    expect(draftIdsOf(rows, [2])).toEqual([]);
    expect(draftIdsOf(rows, [])).toEqual([]);
    expect(canPublish({ status: 'DRAFT' })).toBe(true);
    expect(canPublish({ status: 'PUBLISHED' })).toBe(false);
  });

  it('words the confirmations', () => {
    expect(bulkDeleteText(1)).toBe('1 lesson plan will be deleted for good. This cannot be undone.');
    expect(bulkDeleteText(3)).toBe('3 lesson plans will be deleted for good. This cannot be undone.');
    expect(bulkPublishText(2)).toBe('2 lesson plans will be published and students will be told.');
  });

  it('reports what the server did, including what it skipped', () => {
    expect(bulkDeleteResultText({ requested_count: 3, deleted_count: 3 })).toBe('3 lesson plans deleted.');
    expect(bulkDeleteResultText({ requested_count: 3, deleted_count: 1 })).toBe('1 lesson plan deleted. 2 could not be deleted.');
    expect(bulkPublishResultText({ requested_count: 2, published_count: 2 })).toBe('2 lesson plans published.');
    expect(bulkPublishResultText({ requested_count: 3, published_count: 1 })).toBe('1 lesson plan published. 2 skipped (already published or not yours).');
    expect(bulkPublishResultText(null)).toBe('0 lesson plans published.');
  });
});
