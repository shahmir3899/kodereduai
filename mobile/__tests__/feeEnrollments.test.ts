import { buildCategoryPayload, categoryToForm, emptyCategoryForm, validateCategory } from '../services/financeSetup';
import { classStudentParams, enrollable, enrollPayload, priceLabel, type FeeEnrollment } from '../services/feeEnrollments';

const enrollment = (student: number, amount: string | null = null) =>
  ({ id: student, student, student_name: `S${student}`, start_date: '2026-03-01', end_date: null, amount, is_active: true }) as FeeEnrollment;

describe('fee category billing form', () => {
  it('sends enrolled-only billing with a price for fee categories', () => {
    const form = { ...emptyCategoryForm(), name: 'Robotics', enrolledOnly: true, price: '1500' };
    expect(buildCategoryPayload('monthly', form, [])).toEqual({ name: 'Robotics', description: '', billing_mode: 'ENROLLED', default_amount: '1500' });
  });

  it('switching back to everyone sends ALL and leaves the price alone', () => {
    const form = { ...emptyCategoryForm(), name: 'Tuition' };
    expect(buildCategoryPayload('annual', form, [])).toEqual({ name: 'Tuition', description: '', billing_mode: 'ALL' });
  });

  it('income categories never get billing fields', () => {
    expect(buildCategoryPayload('income', { ...emptyCategoryForm(), name: 'Rent', enrolledOnly: true }, [])).toEqual({ name: 'Rent' });
  });

  it('reads billing from the server and rejects a bad price', () => {
    const form = categoryToForm({ id: 1, name: 'Karate', billing_mode: 'ENROLLED', default_amount: '1200.00' });
    expect([form.enrolledOnly, form.price]).toEqual([true, '1200']);
    expect(validateCategory({ ...form, price: 'abc' })).toBe('Enter a price of 0 or more.');
    expect(validateCategory(form)).toBeNull();
  });
});

describe('enrollments', () => {
  it('offers only students not already enrolled', () => {
    const students = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
    expect(enrollable(students, [enrollment(1)]).map((s) => s.id)).toEqual([2]);
  });

  it('builds the bulk enroll request', () => {
    expect(enrollPayload('annual', 4, [2, 3], '2026-03-15', '', 7)).toEqual({
      annual_category: 4, student_ids: [2, 3], start_date: '2026-03-15', amount: null, academic_year: 7,
    });
    expect(enrollPayload('monthly', 4, [2], '2026-03-15', ' 900 ').amount).toBe('900');
  });

  it('asks for a section with its master class', () => {
    expect(classStudentParams({ id: 9, label: '5-A', classObj: 3, isSession: true }, 1)).toEqual({
      is_active: true, page_size: 9999, academic_year: 1, session_class_id: 9, class_id: 3,
    });
  });

  it('labels the price', () => {
    expect(priceLabel(enrollment(1))).toBe('Default price');
    expect(priceLabel(enrollment(1, '1500.00'))).toBe('Rs 1,500');
  });
});
