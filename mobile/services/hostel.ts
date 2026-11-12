// Hostel for admin and principal: dashboard, hostels and rooms, student allocations, gate passes. Port
// of frontend/src/pages/hostel and backend/hostel (models, serializers, views). Pure logic; the server
// re-checks everything (full rooms, one allocation per student per year, who may approve a pass).

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const HOSTEL_TYPES = [{ value: 'BOYS', label: 'Boys' }, { value: 'GIRLS', label: 'Girls' }, { value: 'MIXED', label: 'Mixed' }];
export const ROOM_TYPES = [{ value: 'SINGLE', label: 'Single' }, { value: 'DOUBLE', label: 'Double' }, { value: 'DORMITORY', label: 'Dormitory' }];
export const PASS_TYPES = [{ value: 'DAY', label: 'Day pass' }, { value: 'OVERNIGHT', label: 'Overnight' }];

// ── Rows ──────────────────────────────────────────────────────────────────────────────────────

export interface HostelRow {
  id: number; name: string; hostel_type: string; hostel_type_display?: string; warden?: number | null; warden_name?: string | null;
  capacity: number; current_occupancy?: number; rooms_count?: number; address?: string | null; contact_number?: string | null; is_active: boolean;
}
export interface RoomRow {
  id: number; hostel: number; hostel_name?: string; room_number: string; floor: number; room_type: string; room_type_display?: string;
  capacity: number; current_occupancy?: number; is_full?: boolean; is_available: boolean;
}
export interface AllocationRow {
  id: number; student: number; student_name: string; student_roll_number?: string | number | null; student_class_name?: string | null;
  room: number; room_number: string; hostel_name: string; academic_year: number; academic_year_name?: string;
  allocated_date?: string; vacated_date?: string | null; is_active: boolean;
}
export interface GatePassRow {
  id: number; student: number; student_name: string; student_roll_number?: string | number | null; hostel_name?: string; room_number?: string;
  pass_type: string; pass_type_display?: string; reason: string; going_to: string; contact_at_destination?: string | null;
  departure_date: string; expected_return: string; actual_return?: string | null; status: string; status_display?: string;
  approved_by_name?: string | null; remarks?: string | null;
}
export interface HostelDashboard {
  total_hostels?: number; total_rooms?: number; total_capacity?: number; current_occupancy?: number; available_beds?: number; pending_gate_passes?: number;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────────────────────

export function dashboardTiles(d: HostelDashboard | undefined): Array<{ label: string; value: string; tone: 'info' | 'success' | 'warning' }> {
  return [
    { label: 'Hostels', value: String(d?.total_hostels ?? 0), tone: 'info' },
    { label: 'Rooms', value: String(d?.total_rooms ?? 0), tone: 'info' },
    { label: 'Beds taken', value: `${d?.current_occupancy ?? 0} of ${d?.total_capacity ?? 0}`, tone: 'success' },
    { label: 'Beds free', value: String(d?.available_beds ?? 0), tone: 'success' },
    { label: 'Passes waiting', value: String(d?.pending_gate_passes ?? 0), tone: (d?.pending_gate_passes ?? 0) > 0 ? 'warning' : 'success' },
  ];
}

// ── Hostels ───────────────────────────────────────────────────────────────────────────────────

export interface HostelForm { name: string; type: string; warden: number | null; capacity: string; address: string; contact: string; active: boolean }
export const emptyHostelForm = (): HostelForm => ({ name: '', type: 'BOYS', warden: null, capacity: '', address: '', contact: '', active: true });
export const hostelToForm = (h: HostelRow): HostelForm => ({
  name: h.name, type: h.hostel_type, warden: h.warden ?? null, capacity: String(h.capacity), address: h.address ?? '', contact: h.contact_number ?? '', active: h.is_active,
});

export function validateHostel(f: HostelForm): string | null {
  if (!f.name.trim()) return 'Enter the hostel name.';
  if (!f.type) return 'Choose the hostel type.';
  if (!/^\d+$/.test(f.capacity.trim())) return 'Enter the capacity as a whole number (0 or more).';
  return null;
}

export const buildHostelPayload = (f: HostelForm) => ({
  name: f.name.trim(), hostel_type: f.type, warden: f.warden, capacity: Number(f.capacity), address: f.address.trim(), contact_number: f.contact.trim(), is_active: f.active,
});

export const hostelLine = (h: HostelRow) =>
  [h.hostel_type_display ?? h.hostel_type, `${h.rooms_count ?? 0} room${h.rooms_count === 1 ? '' : 's'}`, `${h.current_occupancy ?? 0} of ${h.capacity} beds`, h.warden_name ? `Warden ${h.warden_name}` : ''].filter(Boolean).join('  ·  ');

export const deleteHostelText = (h: Pick<HostelRow, 'name'>) =>
  `Delete ${h.name}? Its rooms are deleted with it. A hostel with students allocated cannot be deleted: vacate them first, or mark the hostel inactive.`;

// ── Rooms ─────────────────────────────────────────────────────────────────────────────────────

export interface RoomForm { number: string; floor: string; type: string; capacity: string; available: boolean }
export const emptyRoomForm = (): RoomForm => ({ number: '', floor: '0', type: 'DOUBLE', capacity: '2', available: true });
export const roomToForm = (r: RoomRow): RoomForm => ({ number: r.room_number, floor: String(r.floor), type: r.room_type, capacity: String(r.capacity), available: r.is_available });

// Beds in use; a room cannot be made smaller than that.
export const bedsTaken = (r: Pick<RoomRow, 'current_occupancy'>) => r.current_occupancy ?? 0;

export function validateRoom(f: RoomForm, editing: RoomRow | null): string | null {
  if (!f.number.trim()) return 'Enter the room number.';
  if (!/^\d+$/.test(f.floor.trim())) return 'The floor is a whole number (0 for the ground floor).';
  if (!/^\d+$/.test(f.capacity.trim()) || Number(f.capacity) < 1) return 'The capacity is a whole number, 1 or more.';
  if (editing && Number(f.capacity) < bedsTaken(editing)) return `${bedsTaken(editing)} bed${bedsTaken(editing) === 1 ? ' is' : 's are'} taken, so the capacity cannot be lower than that.`;
  return null;
}

export const buildRoomPayload = (hostel: number, f: RoomForm) => ({
  hostel, room_number: f.number.trim(), floor: Number(f.floor), room_type: f.type, capacity: Number(f.capacity), is_available: f.available,
});

export const roomLine = (r: RoomRow) => `Floor ${r.floor}  ·  ${r.room_type_display ?? r.room_type}  ·  ${bedsTaken(r)} of ${r.capacity} beds`;
export const deleteRoomText = (r: Pick<RoomRow, 'room_number'>) => `Delete room ${r.room_number}? A room with students allocated cannot be deleted.`;

// ── Allocations ───────────────────────────────────────────────────────────────────────────────

export interface AllocationForm { student: number | null; studentLabel: string; room: number | null }
export const emptyAllocationForm = (): AllocationForm => ({ student: null, studentLabel: '', room: null });

export function validateAllocation(f: AllocationForm, academicYear: number | null | undefined): string | null {
  if (!academicYear) return 'There is no current academic year.';
  if (!f.student) return 'Choose the student.';
  if (!f.room) return 'Choose the room.';
  return null;
}

export const buildAllocationPayload = (f: AllocationForm, academicYear: number) => ({ student: f.student, room: f.room, academic_year: academicYear });

// Rooms a student can be placed in: available and with a free bed.
export const freeRooms = (rooms: RoomRow[]): RoomRow[] => rooms.filter((r) => r.is_available && !r.is_full && bedsTaken(r) < r.capacity);
export const roomOption = (r: RoomRow) => `${r.hostel_name ?? ''} · Room ${r.room_number} (${r.capacity - bedsTaken(r)} free)`.replace(/^ · /, '');

export const allocationLine = (a: AllocationRow) => [a.student_class_name, a.student_roll_number ? `Roll ${a.student_roll_number}` : '', `${a.hostel_name}, room ${a.room_number}`].filter(Boolean).join('  ·  ');
export const vacateText = (a: Pick<AllocationRow, 'student_name' | 'hostel_name' | 'room_number'>) =>
  `${a.student_name} will leave ${a.hostel_name}, room ${a.room_number}, and the bed becomes free. The record is kept.`;

// ── Gate passes ───────────────────────────────────────────────────────────────────────────────

// The server calls a checked-out pass USED (not CHECKED_OUT).
export const PASS_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', USED: 'Checked out', RETURNED: 'Returned', EXPIRED: 'Expired',
};
export const PASS_STATUS_TONE: Record<string, 'warning' | 'success' | 'error' | 'info' | 'neutral'> = {
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', USED: 'info', RETURNED: 'success', EXPIRED: 'neutral',
};
export const PASS_FILTERS = [{ value: '', label: 'All' }, { value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'USED', label: 'Out' }, { value: 'RETURNED', label: 'Returned' }];

export type PassAction = 'approve' | 'reject' | 'checkout' | 'return';

// What can be done to a pass in each state (views: approve and reject need PENDING, checkout needs APPROVED, return needs USED).
export function passActions(status: string): PassAction[] {
  if (status === 'PENDING') return ['reject', 'approve'];
  if (status === 'APPROVED') return ['checkout'];
  if (status === 'USED') return ['return'];
  return [];
}

export const PASS_ACTION_LABEL: Record<PassAction, string> = { approve: 'Approve', reject: 'Reject', checkout: 'Check out', return: 'Mark returned' };
export const PASS_ACTION_DONE: Record<PassAction, string> = { approve: 'approved', reject: 'rejected', checkout: 'checked out', return: 'marked returned' };

export const passRemarkPayload = (remark: string) => (remark.trim() ? { remarks: remark.trim() } : {});

// "2026-11-12T08:00:00+05:00" -> "12 Nov, 08:00" without shifting the clock to another zone.
export function passTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}, ${m[4]}:${m[5]}`;
}

export const passLine = (p: GatePassRow) => `${passTime(p.departure_date)} to ${passTime(p.expected_return)}`;

export interface PassForm {
  allocation: number | null; student: number | null; passType: string; goingTo: string; contact: string; reason: string;
  departDate: string; departTime: string; returnDate: string; returnTime: string;
}

export const emptyPassForm = (today: string): PassForm => ({
  allocation: null, student: null, passType: 'DAY', goingTo: '', contact: '', reason: '', departDate: today, departTime: '08:00', returnDate: today, returnTime: '18:00',
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validatePass(f: PassForm): string | null {
  if (!f.allocation || !f.student) return 'Choose the student (a student with a room).';
  if (!f.goingTo.trim()) return 'Enter where the student is going.';
  if (!f.reason.trim()) return 'Enter the reason.';
  if (!ISO_DAY.test(f.departDate) || !ISO_DAY.test(f.returnDate)) return 'Choose the leaving and return dates.';
  if (!TIME.test(f.departTime.trim()) || !TIME.test(f.returnTime.trim())) return 'Enter the times as 24-hour HH:MM, for example 08:00.';
  if (`${f.returnDate}T${f.returnTime}` <= `${f.departDate}T${f.departTime}`) return 'The return must be after the departure.';
  return null;
}

export const buildPassPayload = (f: PassForm) => ({
  student: f.student, allocation: f.allocation, pass_type: f.passType, reason: f.reason.trim(), going_to: f.goingTo.trim(),
  contact_at_destination: f.contact.trim(), departure_date: `${f.departDate}T${f.departTime.trim()}`, expected_return: `${f.returnDate}T${f.returnTime.trim()}`,
});

export const wardenOption = (s: { id: number; full_name: string }) => ({ value: s.id, label: s.full_name });
export const percentFull = (h: Pick<HostelRow, 'capacity' | 'current_occupancy'>) => (h.capacity > 0 ? Math.round((num(h.current_occupancy) / h.capacity) * 100) : 0);
