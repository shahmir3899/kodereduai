import {
  bundleNotifications, groupByDay, isBundle, normalizeNotification, notificationDestination, parseAmount, timeAgo,
  type NotificationRecord,
} from '../services/notificationMeta';
import { notificationsOf } from '../services/manager';

const rec = (o: Partial<NotificationRecord> & { id: number }): NotificationRecord => ({
  title: 't', message: '', created_at: '2026-11-09T08:00:00Z', is_read: false, event_type: 'ABSENCE', school: 1, ...o,
});

describe('normalizeNotification', () => {
  it('maps the API body and event_type (the fields the phone used to miss)', () => {
    const n = normalizeNotification({ id: 3, title: 'Ali absent', body: 'Ali was absent today', event_type: 'ABSENCE', student_name: 'Ali', is_read: false });
    expect(n.message).toBe('Ali was absent today');
    expect(n.event_type).toBe('ABSENCE');
    expect(n.student_name).toBe('Ali');
  });
  it('treats read_at or READ status as read, and falls back to GENERAL', () => {
    expect(normalizeNotification({ id: 1, read_at: '2026-01-01' }).is_read).toBe(true);
    expect(normalizeNotification({ id: 1, status: 'READ' }).is_read).toBe(true);
    expect(normalizeNotification({ id: 1 }).event_type).toBe('GENERAL');
  });
  it('notificationsOf normalises every row', () => {
    expect(notificationsOf({ results: [{ id: 1, body: 'hi' }] })[0].message).toBe('hi');
  });
});

describe('bundleNotifications', () => {
  it('collapses 3+ same type/school/day alerts and keeps members', () => {
    const out = bundleNotifications([rec({ id: 1 }), rec({ id: 2 }), rec({ id: 3 }), rec({ id: 4, event_type: 'GENERAL' })]);
    expect(out).toHaveLength(2);
    const b = out[0];
    expect(isBundle(b) && b.count).toBe(3);
    expect(isBundle(b) && b.title).toBe('3 absence alerts');
  });
  it('leaves fewer than 3 alone', () => {
    expect(bundleNotifications([rec({ id: 1 }), rec({ id: 2 })])).toHaveLength(2);
  });
  it('totals fee amounts only when every member has one', () => {
    const fee = (id: number, message: string) => rec({ id, event_type: 'FEE_DUE', message });
    const all = bundleNotifications([fee(1, 'Rs 1,000'), fee(2, 'Rs. 500'), fee(3, 'Rs 250')])[0];
    expect(isBundle(all) && all.total).toBe(1750);
    const partial = bundleNotifications([fee(1, 'Rs 1,000'), fee(2, 'no amount'), fee(3, 'Rs 250')])[0];
    expect(isBundle(partial) && partial.total).toBeNull();
  });
  it('is read only when every member is', () => {
    const b = bundleNotifications([rec({ id: 1, is_read: true }), rec({ id: 2, is_read: true }), rec({ id: 3 })])[0];
    expect(b.is_read).toBe(false);
  });
});

describe('helpers', () => {
  it('parses amounts', () => { expect(parseAmount('Fee Rs 12,500.50 due')).toBe(12500.5); expect(parseAmount('none')).toBeNull(); });
  it('formats relative time', () => {
    const now = Date.parse('2026-11-09T10:00:00Z');
    expect(timeAgo('2026-11-09T09:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-09T09:30:00Z', now)).toBe('30m ago');
    expect(timeAgo('2026-11-07T10:00:00Z', now)).toBe('2d ago');
  });
  it('groups by Today / Yesterday / Earlier', () => {
    const now = new Date('2026-11-09T12:00:00');
    const g = groupByDay([rec({ id: 1, created_at: '2026-11-09T09:00:00' }), rec({ id: 2, created_at: '2026-11-08T09:00:00' }), rec({ id: 3, created_at: '2026-11-01T09:00:00' })], now);
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday', 'Earlier']);
  });
});

describe('notificationDestination', () => {
  it('sends a student to their own screens', () => {
    expect(notificationDestination(rec({ id: 1, event_type: 'FEE_DUE' }), 'student')).toBe('/(student)/fees');
  });
  it('sends a parent to the child attendance screen, else nowhere', () => {
    expect(notificationDestination(rec({ id: 1, student: 9 }), 'parent')).toBe('/(parent)/children/9/attendance');
    expect(notificationDestination(rec({ id: 1, event_type: 'FEE_DUE', student: 9 }), 'parent')).toBeNull();
  });
  it('gives drivers no destination and unknown events none', () => {
    expect(notificationDestination(rec({ id: 1 }), 'driver')).toBeNull();
    expect(notificationDestination(rec({ id: 1, event_type: 'GENERAL' }), 'admin')).toBeNull();
  });
});
