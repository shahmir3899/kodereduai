import { emptyIconFor } from '../services/emptyIcon';

describe('emptyIconFor', () => {
  it('matches the specific cases before subject words', () => {
    expect(emptyIconFor('Student not found')).toBe('search-outline');
    expect(emptyIconFor('Pick a class and subject')).toBe('hand-left-outline');
    expect(emptyIconFor('Not available')).toBe('lock-closed-outline');
    expect(emptyIconFor('Nobody at risk')).toBe('shield-checkmark-outline');
  });
  it('picks an icon from the subject', () => {
    expect(emptyIconFor('No fee records')).toBe('wallet-outline');
    expect(emptyIconFor('No academic year')).toBe('calendar-outline');
    expect(emptyIconFor('No classes')).toBe('school-outline');
    expect(emptyIconFor('No children linked')).toBe('people-outline');
    expect(emptyIconFor('No staff')).toBe('person-outline');
    expect(emptyIconFor('No results yet')).toBe('document-text-outline');
    expect(emptyIconFor('Nothing overdue')).toBe('library-outline');
    expect(emptyIconFor('Nothing here')).toBe('checkmark-circle-outline');
  });
  it('falls back to a tray', () => {
    expect(emptyIconFor('Empty')).toBe('file-tray-outline');
    expect(emptyIconFor('')).toBe('file-tray-outline');
  });
});
