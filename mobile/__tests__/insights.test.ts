import {
  academicRiskSummary, attendanceRiskSummary, cachedText, staffRiskSummary, studentRiskSummary, summaryText,
} from '../services/insights';

describe('student risk', () => {
  const data = {
    total_students: 100, at_risk_count: 2, risk_levels: { HIGH: 1, MEDIUM: 1, LOW: 0 },
    students: [
      { student_id: 2, student_name: 'Zara', class_name: '5-A', composite_score: 41.6, severity: 'MEDIUM', attendance_severity: 'MEDIUM', fee_risk_level: 'LOW', academic_severity: null },
      { student_id: 1, student_name: 'Ali', class_name: '5-B', composite_score: 80, severity: 'HIGH', attendance_severity: 'HIGH', fee_risk_level: null, academic_severity: 'MEDIUM' },
    ],
  };
  it('orders high before medium and describes each factor', () => {
    const s = studentRiskSummary(data);
    expect(s.rows.map((r) => r.name)).toEqual(['Ali', 'Zara']);
    expect(s.rows[0]).toMatchObject({ headline: 'Risk score 80', details: ['Attendance: high', 'Marks: medium'] });
    expect(s.rows[1].headline).toBe('Risk score 42');
    expect(s).toMatchObject({ total: 100, atRisk: 2, levels: { HIGH: 1, MEDIUM: 1, LOW: 0 } });
  });
});

describe('attendance and academic risk', () => {
  it('keeps students without enough history out of the list but counts them', () => {
    const s = attendanceRiskSummary({
      total_students: 3, risk_levels: { HIGH: 0, MEDIUM: 1, LOW: 0 },
      students: [
        { student_id: 1, student_name: 'A', current_rate: 71.234, severity: 'MEDIUM', trend: 'DECLINING', predicted_rate_4w: 65, consecutive_absent_days: 3, excused_leave_days: 2, suggested_action: 'Call the parent', insufficient_data: false },
        { student_id: 2, student_name: 'B', current_rate: null, severity: null, insufficient_data: true },
        { student_id: 3, student_name: 'C', severity: null, insufficient_data: true },
      ],
    });
    expect(s.rows).toHaveLength(1);
    expect(s.notEnoughData).toBe(2);
    expect(s.rows[0]).toMatchObject({ headline: 'Attendance 71.2%', action: 'Call the parent' });
    expect(s.rows[0].details).toEqual(['Trend: declining', 'Expected in 4 weeks: 65%', '3 days absent in a row', '2 days on approved leave']);
  });
  it('reads marks averages and exam counts', () => {
    const s = academicRiskSummary({ total_students: 1, students: [{ student_id: 1, student_name: 'A', current_average: 48.5, severity: 'HIGH', trend: 'FALLING', exams_recorded: 1 }] });
    expect(s.rows[0]).toMatchObject({ headline: 'Average 48.5%', details: ['Trend: falling', '1 exam counted'] });
    expect(s.atRisk).toBe(1);
  });
});

describe('staff risk', () => {
  it('reads the staff list and absence figures', () => {
    const s = staffRiskSummary({
      total_staff: 20, at_risk_count: 1, risk_levels: { HIGH: 0, MEDIUM: 0, LOW: 1 },
      staff: [{ staff_id: 5, staff_name: 'Sana', department: 'Science', severity: 'LOW', absence_rate: 12.34, leave_days_in_window: 4, absence_trend: 'STABLE', consecutive_absent_days: 0, day_pattern: 'Mondays' }],
    });
    expect(s.rows[0]).toMatchObject({ id: 5, subtitle: 'Science', headline: 'Absent 12.3% of days' });
    expect(s.rows[0].details).toEqual(['4 leave days in the window', 'Trend: stable', 'Pattern: Mondays']);
  });
  it('copes with an empty or missing answer', () => {
    expect(staffRiskSummary(undefined)).toMatchObject({ total: 0, atRisk: 0, rows: [], notEnoughData: 0 });
  });
});

describe('wording', () => {
  it('summarises levels', () => {
    expect(summaryText({ total: 480, atRisk: 12, levels: { HIGH: 2, MEDIUM: 4, LOW: 6 } })).toBe('12 at risk of 480  ·  2 high, 4 medium, 6 low');
    expect(summaryText({ total: 0, atRisk: 0, levels: { HIGH: 0, MEDIUM: 0, LOW: 0 } })).toBe('Nothing to score yet.');
  });
  it('says how old a cached result is', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(cachedText('2026-10-29T11:59:50Z', now)).toBe('Updated just now');
    expect(cachedText('2026-10-29T11:15:00Z', now)).toBe('Updated 45 min ago');
    expect(cachedText('2026-10-29T08:00:00Z', now)).toBe('Updated 4 h ago');
    expect(cachedText('2026-10-26T12:00:00Z', now)).toBe('Updated 3 d ago');
    expect(cachedText(undefined, now)).toBeNull();
    expect(cachedText('nonsense', now)).toBeNull();
  });
});
