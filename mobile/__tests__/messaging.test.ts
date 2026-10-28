import { canSend, roleLabel, sortThreads, threadTitle, timeAgo, totalUnread } from '../services/messaging';

describe('threads', () => {
  const threads = [
    { id: 'a', latest_message_at: '2026-10-01T10:00:00Z', unread_count: 0 },
    { id: 'b', latest_message_at: '2026-10-03T10:00:00Z', unread_count: 2 },
    { id: 'c', created_at: '2026-10-02T10:00:00Z', unread_count: 1 },
  ];
  it('sorts newest activity first, using created_at when nothing was sent', () => {
    expect(sortThreads(threads).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
  it('does not mutate its input', () => {
    const copy = [...threads];
    sortThreads(threads);
    expect(threads).toEqual(copy);
  });
  it('sums unread', () => expect(totalUnread(threads)).toBe(3));
  it('titles by person, then subject', () => {
    expect(threadTitle({ id: 'x', other_participant_name: 'Ms Ali', subject: 'Fees' })).toBe('Ms Ali');
    expect(threadTitle({ id: 'x', subject: 'Fees' })).toBe('Fees');
    expect(threadTitle({ id: 'x' })).toBe('Conversation');
  });
});

describe('labels and times', () => {
  it('formats roles', () => expect(roleLabel('SCHOOL_ADMIN')).toBe('School Admin'));
  it('formats elapsed time', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(timeAgo('2026-10-28T11:59:40Z', now)).toBe('now');
    expect(timeAgo('2026-10-28T11:30:00Z', now)).toBe('30m');
    expect(timeAgo('2026-10-28T09:00:00Z', now)).toBe('3h');
    expect(timeAgo('2026-10-26T12:00:00Z', now)).toBe('2d');
    expect(timeAgo(null, now)).toBe('');
  });
});

describe('canSend', () => {
  it('needs text, and a recipient only for a new thread', () => {
    expect(canSend('  ', 1, true)).toBe(false);
    expect(canSend('hi', null, true)).toBe(false);
    expect(canSend('hi', 5, true)).toBe(true);
    expect(canSend('hi', null, false)).toBe(true);
  });
});
