import type { IconName } from '../components/ui/Icon';

// The icon an empty state shows when the screen does not pick one: chosen from words in its title,
// so the 138 empty states read at a glance without each screen naming an icon. First match wins,
// so the specific rules ("not found", "pick") come before the subject words.
const RULES: Array<[RegExp, IconName]> = [
  [/not found/i, 'search-outline'],
  [/^(pick|choose|select)\b/i, 'hand-left-outline'],
  [/not available|no access/i, 'lock-closed-outline'],
  [/risk/i, 'shield-checkmark-outline'],
  [/fee|account|income|expense|payment|payslip|salary|payroll|discount|ledger|transaction/i, 'wallet-outline'],
  [/session|year|term|calendar|month|timetable|period|schedule|holiday/i, 'calendar-outline'],
  [/class|section|subject/i, 'school-outline'],
  [/student|child|children|parent|enquir|admission/i, 'people-outline'],
  [/staff|teacher|employee|department|designation/i, 'person-outline'],
  [/exam|result|mark|question|paper|worksheet|topic|assignment|task|submission|report|lesson|curriculum|book/i, 'document-text-outline'],
  [/notification|message|conversation|announcement/i, 'chatbubbles-outline'],
  [/library|catalog|overdue|issue/i, 'library-outline'],
  [/route|vehicle|transport|stop|journey|boarding/i, 'bus-outline'],
  [/inventory|item|stock|vendor|categor/i, 'cube-outline'],
  [/hostel|room|allocation|gate pass/i, 'bed-outline'],
  [/leave|attendance|absent|present/i, 'checkbox-outline'],
  [/^nothing|^all (done|clear)|nobody/i, 'checkmark-circle-outline'],
];

export function emptyIconFor(title: string): IconName {
  for (const [re, icon] of RULES) if (re.test(title ?? '')) return icon;
  return 'file-tray-outline';
}
