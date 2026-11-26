// Transport admin on the phone: vehicles, which student rides which route, and daily boarding.
// Ports of the web VehiclesPage, TransportAssignmentsPage and TransportAttendancePage. Writes are
// admin and principal only on the server (IsSchoolAdminOrReadOnly); a teacher sees the same data.

export const VEHICLE_TYPES = [
  { value: 'BUS', label: 'Bus' },
  { value: 'VAN', label: 'Van' },
  { value: 'CAR', label: 'Car' },
] as const;

export const TRANSPORT_TYPES = [
  { value: 'BOTH', label: 'Both (pickup and drop)' },
  { value: 'PICKUP', label: 'Pickup only' },
  { value: 'DROP', label: 'Drop only' },
] as const;
export type TransportType = typeof TRANSPORT_TYPES[number]['value'];

export const BOARDING = [
  { value: 'BOARDED', label: 'Boarded', tone: 'success' },
  { value: 'NOT_BOARDED', label: 'Not boarded', tone: 'warning' },
  { value: 'ABSENT', label: 'Absent', tone: 'error' },
] as const;
export type BoardingStatus = typeof BOARDING[number]['value'];

// ─── Vehicles ───

export interface VehicleRow {
  id: number; vehicle_number: string; vehicle_type: string; vehicle_type_display?: string; capacity?: number | null;
  make_model?: string; driver_name?: string; driver_phone?: string; driver_license?: string;
  assigned_route?: number | null; route_name?: string | null; driver_user_name?: string | null; is_active?: boolean;
}

export interface VehicleForm {
  number: string; type: string; capacity: string; makeModel: string;
  driverName: string; driverPhone: string; driverLicense: string; route: number | null;
}

export const vehicleToForm = (v?: VehicleRow): VehicleForm => ({
  number: v?.vehicle_number ?? '', type: v?.vehicle_type ?? 'BUS', capacity: v?.capacity != null ? String(v.capacity) : '',
  makeModel: v?.make_model ?? '', driverName: v?.driver_name ?? '', driverPhone: v?.driver_phone ?? '',
  driverLicense: v?.driver_license ?? '', route: v?.assigned_route ?? null,
});

// Required as on the web form and the server: number, capacity, driver name and phone.
export function validateVehicle(f: VehicleForm): string | null {
  if (!f.number.trim()) return 'Enter the vehicle number.';
  if (!/^\d+$/.test(f.capacity.trim()) || Number(f.capacity.trim()) < 1) return 'Enter the capacity as a whole number of seats.';
  if (!f.driverName.trim()) return "Enter the driver's name.";
  if (!f.driverPhone.trim()) return "Enter the driver's phone.";
  return null;
}

const VEHICLE_FIELD_LABELS: Record<string, string> = {
  vehicle_number: 'Vehicle number', vehicle_type: 'Type', capacity: 'Capacity', make_model: 'Make / model',
  driver_name: 'Driver name', driver_phone: 'Driver phone', driver_license: 'Driver licence', assigned_route: 'Route',
};

// The server answers field errors ("This field may not be blank."); name the field so it is findable.
export function vehicleErrorMessage(e: unknown): string | null {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (!data || typeof data !== 'object') return null;
  for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== 'string') continue;
    if (field === 'detail' || field === 'non_field_errors') return first;
    return `${VEHICLE_FIELD_LABELS[field] ?? field}: ${first}`;
  }
  return null;
}

// Same body as the web form: blank capacity and route are sent as null.
export const vehiclePayload = (f: VehicleForm) => ({
  vehicle_number: f.number.trim(), vehicle_type: f.type, capacity: f.capacity.trim() ? parseInt(f.capacity.trim(), 10) : null,
  make_model: f.makeModel.trim(), driver_name: f.driverName.trim(), driver_phone: f.driverPhone.trim(),
  driver_license: f.driverLicense.trim(), assigned_route: f.route,
});

export function vehicleLine(v: VehicleRow): string {
  return [v.vehicle_type_display || v.vehicle_type, v.capacity ? `${v.capacity} seats` : null, v.make_model].filter(Boolean).join('  ·  ');
}

export function driverLine(v: VehicleRow): string {
  const who = [v.driver_name, v.driver_phone].filter(Boolean).join('  ·  ');
  return who || 'No driver details';
}

// ─── Student transport ───

export interface TransportAssignmentRow {
  id: number; student: number; student_name?: string; student_roll_number?: string | null; student_class_name?: string | null;
  route: number; route_name?: string; stop: number; stop_name?: string; stop_pickup_time?: string | null; stop_drop_time?: string | null;
  vehicle?: number | null; vehicle_number?: string | null; transport_type?: string; transport_type_display?: string; is_active?: boolean;
}

export function assignmentLine(a: TransportAssignmentRow): string {
  return [a.route_name, a.stop_name, a.vehicle_number].filter(Boolean).join('  ·  ');
}

export interface AssignForm { route: number | null; stop: number | null; vehicle: number | null; type: TransportType }
export const emptyAssignForm = (): AssignForm => ({ route: null, stop: null, vehicle: null, type: 'BOTH' });

export function validateAssign(f: AssignForm, studentIds: number[], yearId: number | null): string | null {
  if (!yearId) return 'Set a current academic year first.';
  if (studentIds.length === 0) return 'Tick at least one student.';
  if (!f.route) return 'Choose the route.';
  if (!f.stop) return 'Choose the stop.';
  return null;
}

// One student is created directly, several go through bulk_assign (which skips anyone already
// assigned this year), exactly as the web does.
export function assignRequest(f: AssignForm, studentIds: number[], yearId: number):
  { kind: 'single'; body: Record<string, unknown> } | { kind: 'bulk'; body: Record<string, unknown> } {
  if (studentIds.length === 1) {
    return { kind: 'single', body: { academic_year: yearId, student: studentIds[0], route: f.route, stop: f.stop, vehicle: f.vehicle, transport_type: f.type } };
  }
  return { kind: 'bulk', body: { academic_year_id: yearId, student_ids: studentIds, route_id: f.route, stop_id: f.stop, vehicle_id: f.vehicle, transport_type: f.type } };
}

export function bulkAssignMessage(reply: { created?: number; skipped?: number } | undefined): string {
  const created = reply?.created ?? 0;
  const skipped = reply?.skipped ? `, ${reply.skipped} skipped (already assigned)` : '';
  return `${created} student${created === 1 ? '' : 's'} assigned${skipped}.`;
}

// Students of the class not on any route yet this year: the only ones worth ticking.
export function unassignedStudents<T extends { id: number }>(students: T[], assigned: TransportAssignmentRow[]): T[] {
  const taken = new Set(assigned.map((a) => a.student));
  return students.filter((s) => !taken.has(s.id));
}

// ─── Boarding ───

export interface BoardingRecord { student: number; boarding_status: string }

// Saved marks for the day; a student with no mark counts as Boarded, which is what Save records.
export function boardingMap(saved: BoardingRecord[]): Record<number, BoardingStatus> {
  const map: Record<number, BoardingStatus> = {};
  saved.forEach((r) => { map[r.student] = (r.boarding_status as BoardingStatus) || 'BOARDED'; });
  return map;
}

export const statusFor = (map: Record<number, BoardingStatus>, studentId: number): BoardingStatus => map[studentId] || 'BOARDED';

export function boardingBody(routeId: number, date: string, studentIds: number[], map: Record<number, BoardingStatus>) {
  return { route_id: routeId, date, records: studentIds.map((id) => ({ student_id: id, boarding_status: statusFor(map, id) })) };
}

export function boardingCounts(studentIds: number[], map: Record<number, BoardingStatus>): Record<BoardingStatus, number> {
  const out: Record<BoardingStatus, number> = { BOARDED: 0, NOT_BOARDED: 0, ABSENT: 0 };
  studentIds.forEach((id) => { out[statusFor(map, id)] += 1; });
  return out;
}

export function boardingSavedMessage(total: number, reply: { errors?: unknown[] } | undefined): string {
  const saved = total - (reply?.errors?.length ?? 0);
  return `Boarding saved for ${saved} student${saved === 1 ? '' : 's'}.`;
}
