import {
  buildAllocationPayload, buildHostelPayload, buildPassPayload, buildRoomPayload, dashboardTiles, emptyAllocationForm, emptyHostelForm, emptyPassForm, emptyRoomForm,
  freeRooms, hostelLine, passActions, passLine, passRemarkPayload, passTime, roomLine, roomOption, roomToForm, vacateText, validateAllocation, validateHostel,
  validatePass, validateRoom, type RoomRow,
} from '../services/hostel';

const room = (over: Partial<RoomRow> = {}): RoomRow => ({ id: 1, hostel: 2, hostel_name: 'Boys A', room_number: '101', floor: 1, room_type: 'DOUBLE', capacity: 2, current_occupancy: 1, is_available: true, ...over });

describe('hostels', () => {
  it('needs a name, a type and a whole capacity', () => {
    const f = { ...emptyHostelForm(), name: 'Boys A', capacity: '40' };
    expect(validateHostel({ ...f, name: ' ' })).toMatch(/name/i);
    expect(validateHostel({ ...f, capacity: '' })).toMatch(/capacity/i);
    expect(validateHostel({ ...f, capacity: '4.5' })).toMatch(/whole/);
    expect(validateHostel(f)).toBeNull();
    expect(buildHostelPayload({ ...f, name: ' Boys A ', warden: 9 })).toMatchObject({ name: 'Boys A', hostel_type: 'BOYS', warden: 9, capacity: 40, is_active: true });
  });
  it('summarises a hostel on one line', () => {
    expect(hostelLine({ id: 1, name: 'Boys A', hostel_type: 'BOYS', hostel_type_display: 'Boys', capacity: 40, current_occupancy: 12, rooms_count: 1, warden_name: 'Mr Ali', is_active: true }))
      .toBe('Boys  ·  1 room  ·  12 of 40 beds  ·  Warden Mr Ali');
  });
});

describe('rooms', () => {
  const f = { ...emptyRoomForm(), number: '101' };
  it('needs a number, a floor and a capacity of 1 or more', () => {
    expect(validateRoom({ ...f, number: '' }, null)).toMatch(/number/i);
    expect(validateRoom({ ...f, floor: 'x' }, null)).toMatch(/floor/i);
    expect(validateRoom({ ...f, capacity: '0' }, null)).toMatch(/1 or more/);
    expect(validateRoom(f, null)).toBeNull();
  });
  it('will not shrink a room below its occupants', () => {
    const r = room({ current_occupancy: 3, capacity: 4 });
    expect(validateRoom({ ...roomToForm(r), capacity: '2' }, r)).toMatch(/3 beds are taken/);
    expect(validateRoom({ ...roomToForm(r), capacity: '3' }, r)).toBeNull();
    expect(validateRoom({ ...roomToForm(room({ current_occupancy: 1 })), capacity: '0' }, room({ current_occupancy: 1 }))).toMatch(/1 or more/);
  });
  it('builds the request and describes the room', () => {
    expect(buildRoomPayload(2, { ...f, floor: '1', capacity: '3', type: 'DORMITORY' })).toEqual({ hostel: 2, room_number: '101', floor: 1, room_type: 'DORMITORY', capacity: 3, is_available: true });
    expect(roomLine(room({ room_type_display: 'Double' }))).toBe('Floor 1  ·  Double  ·  1 of 2 beds');
  });
});

describe('allocations', () => {
  it('needs the year, a student and a room', () => {
    const f = { ...emptyAllocationForm(), student: 5, studentLabel: 'Sara', room: 1 };
    expect(validateAllocation(f, undefined)).toMatch(/academic year/);
    expect(validateAllocation({ ...f, student: null }, 3)).toMatch(/student/);
    expect(validateAllocation({ ...f, room: null }, 3)).toMatch(/room/);
    expect(validateAllocation(f, 3)).toBeNull();
    expect(buildAllocationPayload(f, 3)).toEqual({ student: 5, room: 1, academic_year: 3 });
  });
  it('offers only rooms that are available and have a free bed', () => {
    const rooms = [room({ id: 1 }), room({ id: 2, current_occupancy: 2 }), room({ id: 3, is_available: false }), room({ id: 4, is_full: true })];
    expect(freeRooms(rooms).map((r) => r.id)).toEqual([1]);
    expect(roomOption(room())).toBe('Boys A · Room 101 (1 free)');
  });
  it('says the record is kept when vacating', () => {
    expect(vacateText({ student_name: 'Sara', hostel_name: 'Girls A', room_number: '7' })).toMatch(/Sara.*Girls A, room 7.*record is kept/);
  });
});

describe('gate passes', () => {
  it('offers the actions the server allows in each state (a checked-out pass is USED)', () => {
    expect(passActions('PENDING')).toEqual(['reject', 'approve']);
    expect(passActions('APPROVED')).toEqual(['checkout']);
    expect(passActions('USED')).toEqual(['return']);
    expect(passActions('CHECKED_OUT')).toEqual([]);
    expect(passActions('RETURNED')).toEqual([]);
    expect(passActions('REJECTED')).toEqual([]);
  });
  it('sends a remark only when one is typed', () => {
    expect(passRemarkPayload('  ')).toEqual({});
    expect(passRemarkPayload(' Parent called ')).toEqual({ remarks: 'Parent called' });
  });
  it('shows times as written, without moving them to another zone', () => {
    expect(passTime('2026-11-12T08:00:00+05:00')).toBe('12 Nov, 08:00');
    expect(passTime('2026-12-01 17:30:00')).toBe('1 Dec, 17:30');
    expect(passTime(null)).toBe('');
  });
  const form = { ...emptyPassForm('2026-11-12'), allocation: 4, student: 9, goingTo: 'Home', reason: 'Family event' };
  it('needs a student with a room, a place, a reason and a return after the departure', () => {
    expect(validatePass({ ...form, allocation: null })).toMatch(/student/);
    expect(validatePass({ ...form, goingTo: ' ' })).toMatch(/going/);
    expect(validatePass({ ...form, reason: '' })).toMatch(/reason/);
    expect(validatePass({ ...form, departTime: '8am' })).toMatch(/HH:MM/);
    expect(validatePass({ ...form, returnTime: '08:00' })).toMatch(/after the departure/);
    expect(validatePass({ ...form, returnDate: '2026-11-11' })).toMatch(/after the departure/);
    expect(validatePass(form)).toBeNull();
  });
  it('sends the fields under the names the server reads', () => {
    expect(buildPassPayload(form)).toEqual({
      student: 9, allocation: 4, pass_type: 'DAY', reason: 'Family event', going_to: 'Home', contact_at_destination: '',
      departure_date: '2026-11-12T08:00', expected_return: '2026-11-12T18:00',
    });
    expect(passLine({ departure_date: '2026-11-12T08:00:00', expected_return: '2026-11-12T18:00:00' } as never)).toBe('12 Nov, 08:00 to 12 Nov, 18:00');
  });
});

describe('dashboard', () => {
  it('shows beds taken out of capacity and flags waiting passes', () => {
    const t = dashboardTiles({ total_hostels: 2, total_rooms: 10, total_capacity: 40, current_occupancy: 12, available_beds: 28, pending_gate_passes: 3 });
    expect(t.map((x) => `${x.label}:${x.value}`)).toEqual(['Hostels:2', 'Rooms:10', 'Beds taken:12 of 40', 'Beds free:28', 'Passes waiting:3']);
    expect(t[4].tone).toBe('warning');
    expect(dashboardTiles(undefined)[4].tone).toBe('success');
  });
});
