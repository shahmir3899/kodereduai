import type { IconName } from '../components/ui/Icon';

// The icon and the short action word an attention card shows for each kind of item, from the
// item's key (admin, teacher and parent lists all use keys; parent keys carry the child's id after
// a dash, so only the part before it counts).
const LOOKS: Record<string, { icon: IconName; action: string }> = {
  att: { icon: 'checkbox-outline', action: 'Mark now' },
  staffatt: { icon: 'people-outline', action: 'Mark now' },
  unpaid: { icon: 'wallet-outline', action: 'Collect' },
  partial: { icon: 'wallet-outline', action: 'Collect' },
  fees: { icon: 'wallet-outline', action: 'View fees' },
  leave: { icon: 'calendar-outline', action: 'Review' },
  payroll: { icon: 'receipt-outline', action: 'Approve' },
  enq: { icon: 'person-add-outline', action: 'Open' },
  lib: { icon: 'library-outline', action: 'Review' },
  stock: { icon: 'cube-outline', action: 'Check stock' },
  ai: { icon: 'sparkles-outline', action: 'View' },
  marks: { icon: 'create-outline', action: 'Enter marks' },
  grade: { icon: 'document-text-outline', action: 'Grade' },
  risk: { icon: 'shield-outline', action: 'View' },
  absent: { icon: 'alert-circle-outline', action: 'View' },
  exam: { icon: 'calendar-outline', action: 'Schedule' },
  messages: { icon: 'chatbubbles-outline', action: 'Read' },
};

export function attentionLook(key: string): { icon: IconName; action: string } {
  return LOOKS[key.split('-')[0]] ?? { icon: 'alert-circle-outline', action: 'Open' };
}
