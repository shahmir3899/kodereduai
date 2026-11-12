import { buildLinkPayload, linkableParentOptions, linkedParentsOf, linkSummary, toggleId, type ParentEntry } from '../services/parentLinks';

const khan: ParentEntry = {
  parent: { id: 7, full_name: 'Mr Khan', phone: '0300-1234567' },
  child_count: 2,
  children: [
    { link_id: 11, student_id: 1, student_name: 'Ali', relation: 'FATHER', is_primary: true },
    { link_id: 12, student_id: 2, student_name: 'Sara', relation: 'FATHER', is_primary: false },
  ],
};
const raza: ParentEntry = {
  parent: { id: 8, username: 'raza' }, child_count: 1,
  children: [{ link_id: 13, student_id: 3, student_name: 'Bilal', relation: 'MOTHER', is_primary: false }],
};

describe('parent links', () => {
  it('finds the parents linked to a student', () => {
    expect(linkedParentsOf([khan, raza], 2).map((x) => [x.parent.id, x.link.link_id])).toEqual([[7, 12]]);
    expect(linkedParentsOf([khan, raza], 99)).toEqual([]);
  });

  it('offers only parents not yet linked, with their child count', () => {
    const options = linkableParentOptions([khan, raza], 1);
    expect(options).toEqual([{ value: 8, label: 'raza (1 child)' }]);
    expect(linkableParentOptions([khan, raza], 3)[0].label).toBe('Mr Khan · 0300-1234567 (2 children)');
  });

  it('builds one request that links a parent to several students', () => {
    expect(buildLinkPayload(7, [2, 3], 'FATHER')).toEqual({ parent_profile_id: 7, student_ids: [2, 3], relation: 'FATHER', is_primary: false });
  });

  it('toggles sibling ticks', () => {
    expect(toggleId([1], 2)).toEqual([1, 2]);
    expect(toggleId([1, 2], 1)).toEqual([2]);
  });

  it('summarises the link count', () => {
    expect([0, 1, 3].map(linkSummary)).toEqual(['No parent linked', '1 parent linked', '3 parents linked']);
  });
});
