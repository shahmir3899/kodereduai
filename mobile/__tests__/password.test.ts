import { passwordProblem } from '../services/password';

describe('passwordProblem', () => {
  it('asks for the current password first', () => expect(passwordProblem('', 'abcdefgh', 'abcdefgh')).toMatch(/current/));
  it('requires 8 characters', () => expect(passwordProblem('old', 'short', 'short')).toMatch(/8 characters/));
  it('rejects reusing the old one', () => expect(passwordProblem('abcdefgh', 'abcdefgh', 'abcdefgh')).toMatch(/different/));
  it('requires a matching confirmation', () => expect(passwordProblem('old', 'abcdefgh', 'abcdefgx')).toMatch(/do not match/));
  it('accepts a valid change', () => expect(passwordProblem('old', 'abcdefgh', 'abcdefgh')).toBeNull());
});
