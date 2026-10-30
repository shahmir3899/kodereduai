// Pure logic for the signed-in user's own profile (name, phone, email, photo).
import type { User } from '../types/models';

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export interface ProfileForm {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
}

export function profileFormFromUser(user: Pick<User, 'first_name' | 'last_name' | 'phone' | 'email'> | null): ProfileForm {
  return {
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
  };
}

const clean = (f: ProfileForm): ProfileForm => ({
  first_name: f.first_name.trim(), last_name: f.last_name.trim(), phone: f.phone.trim(), email: f.email.trim(),
});

export function profileChanged(a: ProfileForm, b: ProfileForm): boolean {
  const x = clean(a); const y = clean(b);
  return x.first_name !== y.first_name || x.last_name !== y.last_name || x.phone !== y.phone || x.email !== y.email;
}

// The server checks the email format too; this catches a typo before the round trip.
export function validateProfile(f: ProfileForm): string | null {
  const c = clean(f);
  if (!c.first_name) return 'Enter your first name.';
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return 'Enter a valid email address.';
  if (c.phone && !/^[0-9+\-()\s]{6,20}$/.test(c.phone)) return 'Enter a valid phone number.';
  return null;
}

// Only the fields that changed are sent, so an untouched field is never overwritten.
export function buildProfilePayload(next: ProfileForm, saved: ProfileForm): Partial<ProfileForm> {
  const n = clean(next); const s = clean(saved);
  const out: Partial<ProfileForm> = {};
  (Object.keys(n) as Array<keyof ProfileForm>).forEach((k) => { if (n[k] !== s[k]) out[k] = n[k]; });
  return out;
}

// Same limits as the server (core.storage.validate_photo_upload), checked before uploading.
export function photoProblem(mime: string | null | undefined, size: number | null | undefined): string | null {
  if (!mime || !PHOTO_MIME_TYPES.includes(mime.toLowerCase())) return 'Choose a JPG, PNG or WEBP photo.';
  if (size != null && size > PHOTO_MAX_BYTES) return 'The photo is too large. The limit is 5 MB.';
  return null;
}

export function displayName(user: Pick<User, 'first_name' | 'last_name' | 'username'> | null): string {
  if (!user) return '';
  return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username;
}

// First error text from a DRF field-error body ({email: ["..."]}) or {error|detail}.
export function profileErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.error === 'string') return d.error;
    if (typeof d.detail === 'string') return d.detail;
    const first = Object.values(d).flat()[0];
    if (typeof first === 'string') return first;
  }
  return fallback;
}
