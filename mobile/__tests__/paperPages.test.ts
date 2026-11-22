import { clampPages, emptyPagesSession, newGroupId, slotState, staleCapture, MAX_PAGES } from '../services/paperPages';

// The photo capture's page slots (block scan only since Paper Builder v2 Phase 7; the review is in blockPaper.test.ts).
describe('page slots', () => {
  it('merges what the phone is doing with what the server reports', () => {
    expect(slotState('uploading', { page_number: 1, upload_id: 1, status: 'EXTRACTED', error_message: '' })).toBe('uploading');
    expect(slotState(undefined, { page_number: 1, upload_id: null, status: 'MISSING', error_message: '' })).toBe('empty');
    expect(slotState('failed', { page_number: 1, upload_id: null, status: 'MISSING', error_message: '' })).toBe('failed');
    expect(slotState(undefined, { page_number: 1, upload_id: 1, status: 'PROCESSING', error_message: '' })).toBe('processing');
    expect(slotState(undefined, { page_number: 1, upload_id: 1, status: 'FAILED', error_message: '' })).toBe('failed');
    expect(slotState(undefined, { page_number: 1, upload_id: 1, status: 'EXTRACTED', error_message: '' })).toBe('extracted');
  });

  it('keeps the page count in range and makes a uuid-shaped group id', () => {
    expect(clampPages('0')).toBe(1);
    expect(clampPages('abc')).toBe(1);
    expect(clampPages('99')).toBe(MAX_PAGES);
    expect(newGroupId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('pages read by the removed old scanner', () => {
  const pages = [{ page_number: 1, upload_id: 1, status: 'EXTRACTED', error_message: '' }];
  it('asks to scan again when every page is read but there are no blocks', () => {
    expect(staleCapture({ complete: true, pages, result: null })).toBe(true);
    expect(staleCapture({ complete: true, pages, result: { sections: [] } })).toBe(true);
  });
  it('waits while reading and is fine for a block result', () => {
    expect(staleCapture({ complete: false, pages, result: null })).toBe(false);
    expect(staleCapture({ complete: true, pages, result: { scan_mode: 'blocks', blocks: [] } })).toBe(false);
    expect(staleCapture(undefined)).toBe(false);
  });
  it('starts empty', () => {
    expect(emptyPagesSession()).toEqual({ groupId: null, totalPages: null });
  });
});
