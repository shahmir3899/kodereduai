import {
  buildProfilePayload, displayName, photoProblem, profileChanged, profileErrorMessage, profileFormFromUser, validateProfile,
} from '../services/profile';

const user = { first_name: 'Ayesha', last_name: 'Khan', phone: '0300 1234567', email: 'a@school.pk', username: 'ayesha' };

describe('profile form', () => {
  it('starts from the user and treats spaces as no change', () => {
    const saved = profileFormFromUser(user);
    expect(profileChanged({ ...saved, first_name: ' Ayesha ' }, saved)).toBe(false);
    expect(profileChanged({ ...saved, phone: '0301' }, saved)).toBe(true);
  });

  it('sends only the fields that changed', () => {
    const saved = profileFormFromUser(user);
    expect(buildProfilePayload({ ...saved, last_name: ' Ali ', email: 'a@school.pk' }, saved)).toEqual({ last_name: 'Ali' });
  });

  it('allows clearing phone and email but not the first name', () => {
    const saved = profileFormFromUser(user);
    expect(validateProfile({ ...saved, phone: '', email: '' })).toBeNull();
    expect(validateProfile({ ...saved, first_name: '  ' })).toMatch(/first name/);
    expect(validateProfile({ ...saved, email: 'not-an-email' })).toMatch(/email/);
    expect(validateProfile({ ...saved, phone: 'abc' })).toMatch(/phone/);
  });
});

describe('photoProblem', () => {
  it('accepts jpg, png and webp up to 5 MB', () => {
    expect(photoProblem('image/jpeg', 1000)).toBeNull();
    expect(photoProblem('IMAGE/PNG', null)).toBeNull();
    expect(photoProblem('image/gif', 1000)).toMatch(/JPG, PNG or WEBP/);
    expect(photoProblem(undefined, 1000)).toMatch(/JPG, PNG or WEBP/);
    expect(photoProblem('image/jpeg', 6 * 1024 * 1024)).toMatch(/5 MB/);
  });
});

describe('displayName and errors', () => {
  it('falls back to the username', () => {
    expect(displayName(user)).toBe('Ayesha Khan');
    expect(displayName({ ...user, first_name: '', last_name: '' })).toBe('ayesha');
    expect(displayName(null)).toBe('');
  });

  it('reads the first server message', () => {
    expect(profileErrorMessage({ response: { data: { email: ['Enter a valid email address.'] } } }, 'x')).toBe('Enter a valid email address.');
    expect(profileErrorMessage({ response: { data: { error: 'File too large.' } } }, 'x')).toBe('File too large.');
    expect(profileErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
