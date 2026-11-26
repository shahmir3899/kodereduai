#!/usr/bin/env node
// Read-only check of the screen rules in docs/MOBILE_UI_REFRESH_PLAN.md (Phases 2 and 5). It changes
// nothing; it lists files that still break a rule so the work list comes from the code.
//   node scripts/ui_audit.js            -> summary + file lists
//   node scripts/ui_audit.js --json     -> machine-readable
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'components'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') && !e.name.startsWith('_layout')) out.push(p);
  }
  return out;
}

// Checked by hand and left as they are (2026-11-26), with the reason.
const EXEMPT = {
  // Waits for camera permission, not data.
  bareSpinner: ['app/(admin)/face-attendance/capture.tsx'],
  // Forms, editors and pickers that hold typed-in drafts: a pull-to-refresh would throw the typing
  // away, so they refresh after saving instead.
  noRefresh: [
    'components/assistant/HistoryList.tsx', 'components/assistant/PreferencesPanel.tsx',
    'components/attendance/ManualAttendanceScreen.tsx', 'components/content/PaperBuilderScreen.tsx',
    'components/content/WorksheetBuilderScreen.tsx', 'components/content/blocks/BlockPaperEditor.tsx',
    'components/content/blocks/PicturePickerSheet.tsx', 'components/exams/BulkTestsScreen.tsx',
    'components/exams/ExamWizardScreen.tsx', 'components/exams/MarksEntryScreen.tsx',
    'components/exams/StudentResponsesScreen.tsx', 'components/finance/FeeGenerationScreen.tsx',
    'components/finance/LedgerPreviewSheet.tsx', 'components/hr/StaffFormScreen.tsx',
    'components/hr/performance/PerformanceInfoButton.tsx', 'components/lms/AssignmentFormScreen.tsx',
    'components/lms/DailyDiaryScreen.tsx', 'components/messaging/NewMessageScreen.tsx',
    'components/notifications/SendNotificationScreen.tsx', 'components/student/StudentTaskDetailScreen.tsx',
    'components/students/ParentLinksSheet.tsx', 'components/students/RenumberSectionSheet.tsx',
    'components/students/StudentFormScreen.tsx',
  ],
  noLoadError: [],
  rawFontSize: [],
  // Default colours a new calendar entry is saved with (the web uses the same two): data, not styling.
  rawColor: ['components/academics/CalendarAdminScreen.tsx'],
  smallIconButton: [],
};

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// End of a JSX opening tag that starts at i, skipping {} and quoted strings (props hold `=>`).
function tagEnd(s, i) {
  let depth = 0;
  let q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q && s[j - 1] !== String.fromCharCode(92)) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return j;
  }
  return -1;
}

const result = { bareSpinner: [], noRefresh: [], noLoadError: [], rawFontSize: [], rawColor: [], smallIconButton: [] };
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
  const loadsData = /\buse(Query|InfiniteQuery)\s*\(|\bisLoading\b/.test(s);
  // A spinner that stands in for a whole screen's first load (button spinners are fine).
  if (/<ActivityIndicator\b|<Spinner\b/.test(s) && loadsData && !/<Skeleton\b|<QueryBoundary\b/.test(s)) {
    result.bareSpinner.push(rel(f));
  }
  // A scrolling screen that loads data should refresh on pull.
  if (loadsData && /<(ScrollView|FlatList|SectionList|AppList|QueryList)\b/.test(s) && !/RefreshControl|onRefresh=|refreshing=/.test(s)) {
    result.noRefresh.push(rel(f));
  }
  // A screen with its own query should show a failed load inline, not only as a toast.
  if (/\buse(Query|InfiniteQuery)\s*\(/.test(s) && !/<ErrorState\b|<QueryBoundary\b|isError|\.error\b/.test(s)) {
    result.noLoadError.push(rel(f));
  }

  // Sizes and colours come from constants/colors.ts (FontSize, GlyphSize, Colors, Palette).
  if (/fontSize: \d/.test(s)) result.rawFontSize.push(rel(f));
  if (/'#[0-9a-fA-F]{3,8}'/.test(s)) result.rawColor.push(rel(f));

  // An icon-only button needs a 44px box or a hitSlop.
  const sm = s.match(/StyleSheet\.create\(\{([\s\S]*?)\n\}\);/);
  const sheet = sm ? sm[1] : '';
  const roomy = (k) => {
    const m = sheet.match(new RegExp('^  ' + k + ': \\{([^\\n]*)', 'm'));
    return !!m && [...m[1].matchAll(/(minHeight|minWidth|height|width): (\d+)/g)].some((x) => Number(x[2]) >= 44);
  };
  const re = /<(TouchableOpacity|Pressable)\b/g;
  let m;
  while ((m = re.exec(s))) {
    const end = tagEnd(s, m.index);
    if (end < 0) continue;
    const attrs = s.slice(m.index, end);
    const after = s.slice(end + 1).trimStart();
    if (!after.startsWith('<Icon ')) continue;
    const rest = after.slice(after.indexOf('/>') + 2).trimStart();
    if (!rest.startsWith('</' + m[1]) || /hitSlop/.test(attrs)) continue;
    const st = attrs.match(/style=\{\[?styles\.([A-Za-z0-9_]+)/);
    if (!(st && roomy(st[1]))) result.smallIconButton.push(`${rel(f)}:${s.slice(0, m.index).split('\n').length}`);
  }
}

for (const k of Object.keys(result)) result[k] = result[k].filter((f) => !EXEMPT[k].includes(f.split(':')[0]));

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(result, null, 2));
} else {
  for (const [k, list] of Object.entries(result)) {
    console.log(`\n${k}: ${list.length}`);
    for (const f of list.sort()) console.log(`  ${f}`);
  }
}
