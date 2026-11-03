import { countOfList, studentListParams, summaryTiles } from '../services/students';

describe('countOfList', () => {
  it('takes the server count from a paged answer', () => {
    expect(countOfList({ count: 258, results: [{}] })).toBe(258);
    expect(countOfList({ count: 0, results: [] })).toBe(0);
  });

  it('counts a plain array', () => {
    expect(countOfList([{}, {}, {}])).toBe(3);
    expect(countOfList([])).toBe(0);
  });

  it('is null, not 0, when the answer has no usable count', () => {
    expect(countOfList(null)).toBeNull();
    expect(countOfList(undefined)).toBeNull();
    expect(countOfList({})).toBeNull();
    expect(countOfList({ count: 'many' })).toBeNull();
    expect(countOfList({ count: NaN })).toBeNull();
  });
});

describe('summaryTiles', () => {
  it('shows total, current, left and the number of classes', () => {
    const tiles = summaryTiles({ total: 1200, current: 1100, left: 100 }, 14);
    expect(tiles.map((t) => [t.label, t.value])).toEqual([['Total students', '1,200'], ['Current', '1,100'], ['Left', '100'], ['Classes', '14']]);
  });

  it('shows a dash for anything not known yet, never a made-up zero', () => {
    const tiles = summaryTiles({ total: null, current: null, left: null }, null);
    expect(tiles.map((t) => t.value)).toEqual(['—', '—', '—', '—']);
  });

  it('keeps a real zero as 0, and a school with no classes as a dash', () => {
    const tiles = summaryTiles({ total: 11, current: 11, left: 0 }, 0);
    expect(tiles[2].value).toBe('0');
    expect(tiles[3].value).toBe('—');
  });

  it('colours current green and classes with the accent', () => {
    const tiles = summaryTiles({ total: 1, current: 1, left: 0 }, 1);
    expect(tiles.map((t) => t.tone)).toEqual(['neutral', 'success', 'neutral', 'info']);
  });
});

describe('the count requests', () => {
  it('ask for a page of one student in the current and left scopes, so the server count is the answer', () => {
    const params = (statusScope: 'current' | 'left') => studentListParams({ term: '', option: null, academicYearId: 5, page: 1, pageSize: 1, statusScope });
    expect(params('current')).toEqual({ page: 1, page_size: 1 });
    expect(params('left')).toEqual({ page: 1, page_size: 1, status_scope: 'left' });
  });
});
