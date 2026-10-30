// School profile: port of the Profile tab of the web Settings page. Pure logic, no React Native
// imports. Name, subdomain and contact details are read-only on the web too; what changes here is
// the logo, the letterhead, the time zone, the exam settings and the attendance risk threshold.

export interface SchoolProfile {
  name: string;
  subdomain?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  timezone?: string | null;
  logo?: string | null;
  letterhead_url?: string | null;
  exam_config?: { weighted_average_enabled?: boolean; comment_tone?: string; comment_length?: string; comment_phrases?: string } | null;
  attendance_config?: { risk_threshold?: number | string } | null;
}

export const DEFAULT_TIME_ZONE = 'Asia/Karachi';
// Same list as frontend/src/utils/schoolTime.js.
export const TIME_ZONES = [
  'Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Kabul', 'Asia/Tashkent',
  'Europe/Istanbul', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
];

// The school's own zone first even when it is not in the list, so it never reads as blank.
export const timeZoneOptions = (current: string | null | undefined): string[] =>
  Array.from(new Set([current || DEFAULT_TIME_ZONE, ...TIME_ZONES]));

export type AssetType = 'logo' | 'letterhead';
export const ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
export const ASSET_MAX_BYTES = 5 * 1024 * 1024;

export function assetProblem(mime: string | null | undefined, size: number | null | undefined): string | null {
  if (!mime || !ASSET_MIME_TYPES.includes(mime.toLowerCase())) return 'Please choose a JPG, PNG, WebP or SVG image.';
  if (size != null && size > ASSET_MAX_BYTES) return 'The image must be under 5 MB.';
  return null;
}

export const ASSET_LABEL: Record<AssetType, string> = { logo: 'logo', letterhead: 'letterhead' };

export const COMMENT_TONES = [
  { value: 'warm', label: 'Warm and encouraging' }, { value: 'formal', label: 'Formal and professional' }, { value: 'brief', label: 'Brief and factual' },
];
export const COMMENT_LENGTHS = [
  { value: 'short', label: 'Short (1 sentence)' }, { value: 'standard', label: 'Standard (2 sentences)' }, { value: 'detailed', label: 'Detailed (3 sentences)' },
];
export const COMMENT_PHRASES_MAX = 300;

export interface CommentSettings { comment_tone: string; comment_length: string; comment_phrases: string }

export const commentSettingsOf = (s: SchoolProfile | undefined | null): CommentSettings => ({
  comment_tone: s?.exam_config?.comment_tone ?? 'warm',
  comment_length: s?.exam_config?.comment_length ?? 'standard',
  comment_phrases: s?.exam_config?.comment_phrases ?? '',
});

export const commentChanged = (draft: CommentSettings, saved: CommentSettings) =>
  draft.comment_tone !== saved.comment_tone || draft.comment_length !== saved.comment_length || draft.comment_phrases.trim() !== saved.comment_phrases.trim();

export function validateComment(c: CommentSettings): string | null {
  if (c.comment_phrases.trim().length > COMMENT_PHRASES_MAX) return `School guidance must be ${COMMENT_PHRASES_MAX} characters or fewer.`;
  return null;
}

export const DEFAULT_RISK_THRESHOLD = 75;
export const riskThresholdOf = (s: SchoolProfile | undefined | null): string =>
  String(s?.attendance_config?.risk_threshold ?? DEFAULT_RISK_THRESHOLD);

export function validateRiskThreshold(text: string): string | null {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) return 'Enter a percentage from 0 to 100.';
  return null;
}

export const contactLines = (s: SchoolProfile): Array<{ label: string; value: string }> => [
  { label: 'Name', value: s.name },
  { label: 'Subdomain', value: s.subdomain || '-' },
  { label: 'Email', value: s.contact_email || '-' },
  { label: 'Phone', value: s.contact_phone || '-' },
  ...(s.address ? [{ label: 'Address', value: s.address }] : []),
];
