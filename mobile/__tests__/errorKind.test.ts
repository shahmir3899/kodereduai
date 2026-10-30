import { classifyError, errorCopy, saveFailureMessage } from '../services/errorKind';
import { queryViewState } from '../services/queryRules';

describe('classifyError', () => {
  it('treats a response-less network error as offline', () => {
    expect(classifyError({ code: 'ERR_NETWORK' })).toBe('offline');
  });

  it('treats an aborted request as a timeout', () => {
    expect(classifyError({ code: 'ECONNABORTED' })).toBe('timeout');
  });

  it('maps statuses to kinds', () => {
    expect(classifyError({ response: { status: 403 } })).toBe('forbidden');
    expect(classifyError({ response: { status: 404 } })).toBe('notFound');
    expect(classifyError({ response: { status: 502 } })).toBe('server');
    expect(classifyError({ response: { status: 400 } })).toBe('unknown');
  });

  it('falls back to unknown for nothing', () => {
    expect(classifyError(undefined)).toBe('unknown');
  });
});

describe('errorCopy', () => {
  it('names a connection problem instead of a generic failure', () => {
    expect(errorCopy({ code: 'ERR_NETWORK' }).title).toBe('No connection');
  });
});

describe('saveFailureMessage', () => {
  it('tells the user nothing was saved when offline', () => {
    expect(saveFailureMessage({ code: 'ERR_NETWORK' })).toMatch(/Not saved/);
  });

  it('uses the fallback for other failures', () => {
    expect(saveFailureMessage({ response: { status: 400 } }, 'Could not send.')).toBe('Could not send.');
  });
});

describe('queryViewState offline', () => {
  const base = { isLoading: false, isError: false, hasData: false, isEmpty: false };

  it('shows offline for a paused first load, not empty', () => {
    expect(queryViewState({ ...base, isPaused: true })).toBe('offline');
  });

  it('keeps cached data on screen while paused', () => {
    expect(queryViewState({ ...base, hasData: true, isPaused: true })).toBe('content');
  });
});
