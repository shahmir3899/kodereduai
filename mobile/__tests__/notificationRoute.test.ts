import { notificationTapRoute } from '../services/notificationRoute';

describe('notificationTapRoute', () => {
  it('opens the persona inbox when the payload has no screen', () => {
    expect(notificationTapRoute('admin', { log_id: 5 })).toBe('/(admin)/inbox');
    expect(notificationTapRoute('driver', undefined)).toBe('/(driver)/inbox');
    expect(notificationTapRoute('parent', null)).toBe('/(parent)/inbox');
  });
  it('opens the teacher inbox too', () => {
    expect(notificationTapRoute('teacher', {})).toBe('/(teacher)/inbox');
  });
  it('honours a screen inside the same persona group', () => {
    expect(notificationTapRoute('parent', { screen: '/(parent)/leave' })).toBe('/(parent)/leave');
  });
  it('ignores a screen in another group or of the wrong type', () => {
    expect(notificationTapRoute('driver', { screen: '/(admin)/finance' })).toBe('/(driver)/inbox');
    expect(notificationTapRoute('driver', { screen: 42 })).toBe('/(driver)/inbox');
  });
});
