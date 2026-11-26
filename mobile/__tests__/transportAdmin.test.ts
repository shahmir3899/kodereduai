import {
  assignRequest, boardingBody, boardingCounts, boardingMap, boardingSavedMessage, bulkAssignMessage, driverLine, statusFor,
  unassignedStudents, validateAssign, validateVehicle, vehicleErrorMessage, vehicleLine, vehiclePayload, vehicleToForm,
} from '../services/transportAdmin';

describe('vehicles', () => {
  it('needs the number, capacity, driver name and phone, as the server does', () => {
    const f = vehicleToForm();
    expect(validateVehicle(f)).toBe('Enter the vehicle number.');
    expect(validateVehicle({ ...f, number: 'ABC-1', capacity: '12.5' })).toMatch(/whole number/);
    expect(validateVehicle({ ...f, number: 'ABC-1', capacity: '' })).toMatch(/whole number/);
    expect(validateVehicle({ ...f, number: 'ABC-1', capacity: '12' })).toBe("Enter the driver's name.");
    expect(validateVehicle({ ...f, number: 'ABC-1', capacity: '12', driverName: 'Ali' })).toBe("Enter the driver's phone.");
    expect(validateVehicle({ ...f, number: 'ABC-1', capacity: '12', driverName: 'Ali', driverPhone: '0300' })).toBeNull();
  });

  it('names the field in a server error', () => {
    expect(vehicleErrorMessage({ response: { data: { driver_phone: ['This field may not be blank.'] } } })).toBe('Driver phone: This field may not be blank.');
    expect(vehicleErrorMessage({ response: { data: { detail: 'Nope.' } } })).toBe('Nope.');
    expect(vehicleErrorMessage(new Error('x'))).toBeNull();
  });

  it('sends the web body: blank capacity and route as null, text trimmed', () => {
    expect(vehiclePayload({ ...vehicleToForm(), number: ' abc-1 ', capacity: '', driverName: ' Ali ' })).toEqual({
      vehicle_number: 'abc-1', vehicle_type: 'BUS', capacity: null, make_model: '', driver_name: 'Ali', driver_phone: '',
      driver_license: '', assigned_route: null,
    });
    expect(vehiclePayload({ ...vehicleToForm(), number: 'X', capacity: '40', route: 3 })).toMatchObject({ capacity: 40, assigned_route: 3 });
  });

  it('round-trips a saved vehicle into the form', () => {
    const v = { id: 1, vehicle_number: 'BUS-7', vehicle_type: 'VAN', capacity: 12, assigned_route: 2, driver_name: 'Ali' };
    expect(vehicleToForm(v)).toMatchObject({ number: 'BUS-7', type: 'VAN', capacity: '12', route: 2, driverName: 'Ali' });
    expect(vehicleLine({ ...v, vehicle_type_display: 'Van', make_model: 'Hiace' })).toBe('Van  ·  12 seats  ·  Hiace');
    expect(driverLine({ id: 1, vehicle_number: 'x', vehicle_type: 'BUS' })).toBe('No driver details');
  });
});

describe('student transport', () => {
  const form = { route: 1, stop: 5, vehicle: null, type: 'BOTH' as const };

  it('checks year, students, route and stop', () => {
    expect(validateAssign(form, [1], null)).toMatch(/academic year/);
    expect(validateAssign(form, [], 3)).toBe('Tick at least one student.');
    expect(validateAssign({ ...form, route: null }, [1], 3)).toBe('Choose the route.');
    expect(validateAssign({ ...form, stop: null }, [1], 3)).toBe('Choose the stop.');
    expect(validateAssign(form, [1], 3)).toBeNull();
  });

  it('creates one student directly and several through bulk assign, as the web does', () => {
    expect(assignRequest(form, [9], 3)).toEqual({
      kind: 'single', body: { academic_year: 3, student: 9, route: 1, stop: 5, vehicle: null, transport_type: 'BOTH' },
    });
    expect(assignRequest({ ...form, vehicle: 2, type: 'PICKUP' }, [9, 10], 3)).toEqual({
      kind: 'bulk', body: { academic_year_id: 3, student_ids: [9, 10], route_id: 1, stop_id: 5, vehicle_id: 2, transport_type: 'PICKUP' },
    });
  });

  it('reports created and skipped, and offers only students not on a route', () => {
    expect(bulkAssignMessage({ created: 2, skipped: 1 })).toBe('2 students assigned, 1 skipped (already assigned).');
    expect(bulkAssignMessage({ created: 1 })).toBe('1 student assigned.');
    const students = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(unassignedStudents(students, [{ id: 10, student: 2, route: 1, stop: 1 }]).map((s) => s.id)).toEqual([1, 3]);
  });
});

describe('boarding', () => {
  it('defaults an unmarked student to Boarded and saves every student on the route', () => {
    const map = boardingMap([{ student: 2, boarding_status: 'ABSENT' }]);
    expect(statusFor(map, 1)).toBe('BOARDED');
    expect(statusFor(map, 2)).toBe('ABSENT');
    expect(boardingBody(4, '2026-11-24', [1, 2], map)).toEqual({
      route_id: 4, date: '2026-11-24',
      records: [{ student_id: 1, boarding_status: 'BOARDED' }, { student_id: 2, boarding_status: 'ABSENT' }],
    });
    expect(boardingCounts([1, 2, 3], map)).toEqual({ BOARDED: 2, NOT_BOARDED: 0, ABSENT: 1 });
  });

  it('counts students the server could not save', () => {
    expect(boardingSavedMessage(5, { errors: [{}, {}] })).toBe('Boarding saved for 3 students.');
    expect(boardingSavedMessage(1, undefined)).toBe('Boarding saved for 1 student.');
  });
});
