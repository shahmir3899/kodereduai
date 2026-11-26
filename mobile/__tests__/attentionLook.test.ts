import { attentionLook } from '../services/attentionLook';

describe('attentionLook', () => {
  it('gives each kind its icon and action', () => {
    expect(attentionLook('att')).toEqual({ icon: 'checkbox-outline', action: 'Mark now' });
    expect(attentionLook('marks').action).toBe('Enter marks');
    expect(attentionLook('unpaid').icon).toBe('wallet-outline');
  });
  it('reads parent keys by the part before the child id', () => {
    expect(attentionLook('fees-489').icon).toBe('wallet-outline');
    expect(attentionLook('absent-12').action).toBe('View');
  });
  it('falls back for an unknown kind', () => {
    expect(attentionLook('something')).toEqual({ icon: 'alert-circle-outline', action: 'Open' });
  });
});
