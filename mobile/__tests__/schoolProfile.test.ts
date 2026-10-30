import {
  assetProblem, ASSET_MAX_BYTES, commentChanged, commentSettingsOf, contactLines, riskThresholdOf, timeZoneOptions, validateComment, validateRiskThreshold,
  type SchoolProfile,
} from '../services/schoolProfile';

const school = (over: Partial<SchoolProfile> = {}): SchoolProfile => ({ name: 'Demo School', subdomain: 'demo', ...over });

describe('time zones', () => {
  it('puts the school zone first, once', () => {
    expect(timeZoneOptions('Asia/Karachi')[0]).toBe('Asia/Karachi');
    expect(timeZoneOptions('Asia/Karachi').filter((z) => z === 'Asia/Karachi')).toHaveLength(1);
    expect(timeZoneOptions('Africa/Cairo')[0]).toBe('Africa/Cairo');
    expect(timeZoneOptions(null)[0]).toBe('Asia/Karachi');
  });
});

describe('logo and letterhead', () => {
  it('takes the types and size the server takes', () => {
    expect(assetProblem('image/png', 1000)).toBeNull();
    expect(assetProblem('image/svg+xml', 1000)).toBeNull();
    expect(assetProblem('application/pdf', 1000)).toMatch(/JPG/);
    expect(assetProblem(undefined, 1000)).toMatch(/JPG/);
    expect(assetProblem('image/jpeg', ASSET_MAX_BYTES + 1)).toMatch(/5 MB/);
    expect(assetProblem('image/jpeg', null)).toBeNull();
  });
});

describe('report card comments', () => {
  it('starts from the saved settings or the web defaults', () => {
    expect(commentSettingsOf(school())).toEqual({ comment_tone: 'warm', comment_length: 'standard', comment_phrases: '' });
    expect(commentSettingsOf(school({ exam_config: { comment_tone: 'brief', comment_length: 'short', comment_phrases: 'Hi' } })))
      .toEqual({ comment_tone: 'brief', comment_length: 'short', comment_phrases: 'Hi' });
  });

  it('notices a change, ignoring stray spaces', () => {
    const saved = commentSettingsOf(school());
    expect(commentChanged(saved, saved)).toBe(false);
    expect(commentChanged({ ...saved, comment_phrases: '  ' }, saved)).toBe(false);
    expect(commentChanged({ ...saved, comment_tone: 'formal' }, saved)).toBe(true);
  });

  it('limits the guidance to 300 characters', () => {
    const saved = commentSettingsOf(school());
    expect(validateComment({ ...saved, comment_phrases: 'x'.repeat(300) })).toBeNull();
    expect(validateComment({ ...saved, comment_phrases: 'x'.repeat(301) })).toMatch(/300/);
  });
});

describe('attendance risk threshold', () => {
  it('defaults to 75 and accepts 0 to 100', () => {
    expect(riskThresholdOf(school())).toBe('75');
    expect(riskThresholdOf(school({ attendance_config: { risk_threshold: 80 } }))).toBe('80');
    expect(validateRiskThreshold('0')).toBeNull();
    expect(validateRiskThreshold('100')).toBeNull();
    expect(validateRiskThreshold('101')).toMatch(/0 to 100/);
    expect(validateRiskThreshold('')).toMatch(/0 to 100/);
    expect(validateRiskThreshold('abc')).toMatch(/0 to 100/);
  });
});

describe('school details', () => {
  it('lists the read-only details, with the address only when there is one', () => {
    expect(contactLines(school({ contact_email: 'a@b.pk' })).map((l) => l.label)).toEqual(['Name', 'Subdomain', 'Email', 'Phone']);
    expect(contactLines(school({ address: 'Lahore' })).pop()).toEqual({ label: 'Address', value: 'Lahore' });
    expect(contactLines(school()).find((l) => l.label === 'Phone')?.value).toBe('-');
  });
});
