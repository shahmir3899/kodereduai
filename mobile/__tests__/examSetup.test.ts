import {
  buildExamTypePayload, buildGradePayload, emptyExamTypeForm, emptyGradeForm, examTypeToForm, gradeToForm, gradeTone,
  scaleWarnings, validateExamType, validateGrade,
} from '../services/examSetup';

describe('exam types', () => {
  it('needs a name and a weight from 0 to 100', () => {
    expect(validateExamType(emptyExamTypeForm())).toMatch(/name/i);
    expect(validateExamType({ name: 'Mid', weight: '', isFinal: false })).toMatch(/weight/i);
    expect(validateExamType({ name: 'Mid', weight: '101', isFinal: false })).toMatch(/weight/i);
    expect(validateExamType({ name: 'Mid', weight: 'x', isFinal: false })).toMatch(/weight/i);
    expect(validateExamType({ name: 'Mid', weight: '40.5', isFinal: true })).toBeNull();
  });

  it('builds the payload and round-trips the form', () => {
    expect(buildExamTypePayload({ name: ' Final ', weight: '60', isFinal: true })).toEqual({ name: 'Final', weight: 60, is_final: true });
    expect(examTypeToForm({ id: 1, name: 'Final', weight: '60.00', is_final: true })).toEqual({ name: 'Final', weight: '60.00', isFinal: true });
  });
});

describe('grade form', () => {
  const ok = { label: 'A', min: '80', max: '100', gpa: '4', order: '1' };

  it('validates label and the 0 to 100 range', () => {
    expect(validateGrade(emptyGradeForm())).toMatch(/label/i);
    expect(validateGrade({ ...ok, min: '' })).toMatch(/minimum/i);
    expect(validateGrade({ ...ok, max: '120' })).toMatch(/maximum/i);
    expect(validateGrade({ ...ok, min: '90', max: '80' })).toMatch(/higher/i);
    expect(validateGrade({ ...ok, gpa: 'abc' })).toMatch(/gpa/i);
    expect(validateGrade(ok)).toBeNull();
  });

  it('sends 0 for a blank order or GPA, never NaN', () => {
    expect(buildGradePayload({ ...ok, gpa: '', order: '' })).toEqual({ grade_label: 'A', min_percentage: 80, max_percentage: 100, order: 0, gpa_points: 0 });
  });

  it('fills the form from a saved grade', () => {
    expect(gradeToForm({ id: 1, grade_label: 'B', min_percentage: '70.00', max_percentage: '79.99', gpa_points: null, order: 2 }))
      .toEqual({ label: 'B', min: '70.00', max: '79.99', gpa: '', order: '2' });
  });
});

describe('scale warnings', () => {
  const g = (grade_label: string, min: number, max: number) => ({ grade_label, min_percentage: min, max_percentage: max });

  it('is quiet for a scale that covers 0 to 100', () => {
    expect(scaleWarnings([g('A', 80, 100), g('B', 60, 79), g('F', 0, 59)])).toEqual([]);
  });

  it('flags an overlap', () => {
    expect(scaleWarnings([g('A', 75, 100), g('B', 60, 80), g('F', 0, 59)])).toEqual(['B and A overlap.']);
  });

  it('flags gaps at the bottom, middle and top', () => {
    const w = scaleWarnings([g('A', 90, 95), g('C', 50, 60)]);
    expect(w).toContain('No grade covers 0 to 50%.');
    expect(w).toContain('No grade covers 60% to 90%.');
    expect(w).toContain('No grade covers 95% to 100%.');
  });

  it('has nothing to say about an empty scale', () => {
    expect(scaleWarnings([])).toEqual([]);
  });
});

describe('grade tone', () => {
  it('colours by the first letter', () => {
    expect(gradeTone('A+')).toBe('success');
    expect(gradeTone('b')).toBe('info');
    expect(gradeTone('C')).toBe('warning');
    expect(gradeTone('F')).toBe('error');
    expect(gradeTone('Pass')).toBe('neutral');
  });
});
