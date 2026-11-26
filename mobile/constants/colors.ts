export const Colors = {
  // Primary
  primary: '#1e40af',
  primaryLight: '#3b82f6',
  primaryDark: '#1e3a8a',

  // Secondary
  secondary: '#7c3aed',
  secondaryLight: '#a78bfa',

  // Background
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceSecondary: '#f1f5f9',

  // Text
  text: '#0f172a',
  textSecondary: '#64748b',
  // Both used for real text (inactive tabs, placeholders); #94a3b8 was 2.6:1 on white, under the 4.5:1 minimum.
  textTertiary: '#6b7280',
  textInverse: '#ffffff',

  // Status
  success: '#16a34a',
  successLight: '#dcfce7',
  warning: '#d97706',
  warningLight: '#fef3c7',
  error: '#dc2626',
  errorLight: '#fee2e2',
  // Darker shades of the four status colours for TEXT on their Light backgrounds (pills, badges):
  // the base colours are fine for icons and fills but only reach 2.9 to 3.9:1 as text on them.
  successText: '#166534',
  warningText: '#92400e',
  errorText: '#b91c1c',
  infoText: '#0369a1',
  neutralText: '#475569',
  info: '#0284c7',
  infoLight: '#e0f2fe',

  // Attendance
  present: '#16a34a',
  absent: '#dc2626',
  late: '#d97706',
  leave: '#7c3aed',

  // Fee status
  paid: '#16a34a',
  unpaid: '#dc2626',
  partial: '#d97706',

  // Gateway brands
  jazzcash: '#e1261c',
  easypaisa: '#00a651',

  // Borders
  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  // Misc
  overlay: 'rgba(0, 0, 0, 0.5)',
  shadow: '#000000',
  disabled: '#cbd5e1',
  placeholder: '#6b7280',

  // One-off shades that used to be written inline in screens.
  leaveLight: '#ede9fe',     // background behind the purple "Leave" mark
  purpleLight: '#f3e8ff',    // purple badge background (text uses `secondary`)
  infoBorder: '#bfdbfe',     // outline of a new notification
  errorSoft: '#fca5a5',      // "pending" share in the fee chart
  star: '#f59e0b',           // report card stars
  gold: '#eab308',           // 1st place
  silver: '#9ca3af',         // 2nd place
  bronze: '#d97706',         // 3rd place
  black: '#000000',          // camera background
} as const;

// Fixed colour sets, kept here so screens never hold raw colours.
export const Palette = {
  // Timetable subject colours, given out in turn so neighbouring subjects differ.
  subjects: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'],
  // Timetable rows that are not lessons.
  slots: { BREAK: '#FEF9C3', LUNCH: '#FFEDD5', ASSEMBLY: '#DBEAFE' },
  // The voice assistant orb's moods (ring, fill, ink), matching the web.
  talkOrb: {
    blue: { ring: '#378ADD', fill: '#E6F1FB', ink: '#185FA5' },
    red: { ring: '#E24B4A', fill: '#FCEBEB', ink: '#A32D2D' },
    slate: { ring: '#94A3B8', fill: '#F1F5F9', ink: '#334155' },
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Text sizes. Screens use these names, never raw numbers (scripts/ui_audit.js checks).
// xxs is for badges and chart axis labels only; display is for one big figure on a screen.
export const FontSize = {
  xxs: 10,
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  display: 36,
} as const;

// Symbols drawn with text (‹ › arrows, ✓ ticks, the odd emoji). They are icons, not words, so they
// have their own sizes instead of borrowing text ones.
export const GlyphSize = {
  sm: 20,
  md: 24,
  lg: 28,
} as const;

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;
