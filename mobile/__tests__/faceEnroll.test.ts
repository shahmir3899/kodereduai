import {
  COVERAGE_FILTERS, buildEnrollPayload, coverageLine, coverageSummaryLine, duplicateOf, enrollErrorText, enrollOutcome, filterCoverage, isDuplicateMessage, overrideText,
  photoMime, photoName, photosToAdd, type CoverageStudent,
} from '../services/faceEnroll';

const row = (over: Partial<CoverageStudent> = {}): CoverageStudent => ({ student_id: 1, name: 'Sara', roll_number: 4, samples: 1, status: 'needs_more', ...over });

describe('coverage', () => {
  it('filters by state and offers a filter for every state', () => {
    const rows = [row({ student_id: 1 }), row({ student_id: 2, status: 'ok' }), row({ student_id: 3, status: 'not_enrolled', samples: 0 })];
    expect(filterCoverage(rows, '').length).toBe(3);
    expect(filterCoverage(rows, 'ok').map((r) => r.student_id)).toEqual([2]);
    expect(filterCoverage(rows, 'not_enrolled').map((r) => r.student_id)).toEqual([3]);
    expect(COVERAGE_FILTERS.map((f) => f.value)).toEqual(['', 'not_enrolled', 'needs_more', 'refresh_due', 'ok']);
  });
  it('sums the class up in one line, mentioning refresh only when due', () => {
    expect(coverageSummaryLine({ summary: { total: 30, ok: 20, not_enrolled: 6, needs_more: 4, refresh_due: 0 } })).toBe('20 of 30 fully enrolled  ·  6 not enrolled  ·  4 need more photos');
    expect(coverageSummaryLine({ summary: { total: 5, ok: 1, not_enrolled: 1, needs_more: 1, refresh_due: 2 } })).toContain('2 due a refresh');
    expect(coverageSummaryLine(undefined)).toBe('');
  });
  it('shows roll and photos so far, and how many more are wanted', () => {
    expect(coverageLine(row(), 3)).toBe('Roll 4  ·  1 of 3 photos');
    expect(coverageLine(row({ roll_number: null, samples: 0 }), 3)).toBe('No photo yet');
    expect(photosToAdd(1, 3)).toBe(2);
    expect(photosToAdd(5, 3)).toBe(0);
  });
});

describe('enrolling from a photo', () => {
  it('sends the override only when asked for', () => {
    expect(buildEnrollPayload(7, 'https://x/y.jpg')).toEqual({ student_id: 7, image_url: 'https://x/y.jpg' });
    expect(buildEnrollPayload(7, 'https://x/y.jpg', true)).toEqual({ student_id: 7, image_url: 'https://x/y.jpg', override_duplicate: true });
  });
  it('reads the background task: working, done, failed, or a duplicate', () => {
    expect(enrollOutcome(undefined)).toEqual({ state: 'running' });
    expect(enrollOutcome({ status: 'PENDING' })).toEqual({ state: 'running' });
    expect(enrollOutcome({ status: 'STARTED' })).toEqual({ state: 'running' });
    expect(enrollOutcome({ status: 'SUCCESS' })).toEqual({ state: 'done', message: 'Face enrolled.' });
    expect(enrollOutcome({ status: 'FAILED', error_message: 'No face found in the photo.' })).toEqual({ state: 'failed', message: 'No face found in the photo.' });
    expect(enrollOutcome({ status: 'FAILED', error_message: '' })).toMatchObject({ state: 'failed', message: expect.stringMatching(/clearer/) });
    const dup = "Duplicate face detected — this looks like Sara Khan (already enrolled, 92% confidence). If these are different people, retry enrollment with 'Override duplicate check' enabled.";
    expect(enrollOutcome({ status: 'FAILED', error_message: dup })).toEqual({ state: 'duplicate', message: dup });
  });
  it('picks the other student out of the duplicate message, and warns before overriding', () => {
    const dup = 'Duplicate face detected — this looks like Sara Khan (already enrolled, 92% confidence).';
    expect(isDuplicateMessage(dup)).toBe(true);
    expect(isDuplicateMessage('No face found')).toBe(false);
    expect(duplicateOf(dup)).toBe('Sara Khan');
    expect(duplicateOf('something else')).toBeNull();
    expect(overrideText('Ali', 'Sara Khan')).toMatch(/Sara Khan.*already enrolled.*Ali and Sara Khan are different people/);
    expect(overrideText('Ali', null)).toMatch(/another enrolled student/);
  });
  it('reads a server refusal, else a fallback, else a connection message', () => {
    expect(enrollErrorText({ response: { data: { error: 'Student does not belong to your school.' } } })).toBe('Student does not belong to your school.');
    expect(enrollErrorText({ response: { data: { detail: 'Not allowed' } } })).toBe('Not allowed');
    expect(enrollErrorText({ response: { data: {} } }, 'fallback')).toBe('fallback');
    expect(enrollErrorText(new Error('Network Error'))).toMatch(/connection/i);
  });
  it('names the photo and its type from the picked file', () => {
    expect(photoMime('file:///a/b/IMG_1.PNG')).toBe('image/png');
    expect(photoMime('file:///a/b/IMG_1.jpg')).toBe('image/jpeg');
    expect(photoName('file:///a/b/IMG_1.jpg?x=1', 'x.jpg')).toBe('IMG_1.jpg');
    expect(photoName('', 'fallback.jpg')).toBe('fallback.jpg');
  });
});
