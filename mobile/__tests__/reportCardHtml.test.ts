import { esc, gradeKeyText, ordinal, positionText, renderReportCardHtml, type CardReport } from '../services/reportCardHtml';

const exam = (id: number, name: string, main = false, marks: Record<string, unknown> = {}) =>
  ({ exam_id: id, exam_name: name, is_main: main, marks } as never);

const base: CardReport = {
  student_name: 'Ayesha <Khan>', class_name: 'Grade 1 - A', roll_number: '7', guardian_name: 'Mr Khan', school_name: 'Demo School',
  academic_year_name: '2026-27', exam_display: 'Cycle Test', term_name: 'Term 1', issue_date: '2026-11-02', class_size: 30,
  subjects: [
    { subject_id: 1, subject_name: 'Maths', total_marks: 75, marks_obtained: 65, percentage: 86.7, grade: 'A', class_avg: 70, is_pass: true, comment: 'Good <work>' },
    { subject_id: 2, subject_name: 'Urdu', total_marks: 75, marks_obtained: 20, percentage: 26.7, grade: 'F', class_avg: 60, is_pass: false },
  ],
  exams: [exam(1, 'Cycle Test', true, { 1: { marks_obtained: 65, total_marks: 75 }, 2: { marks_obtained: 20, total_marks: 75 } })],
  summary: { rank: 3, grade: 'B', total_marks: 150, obtained_marks: 85, percentage: 56.7, overall_pass: false },
  attendance: { working_days: 20, present: 17, absent: 2, leave: 1, percentage: 85, from: '2026-10-01', to: '2026-10-31' },
  conduct_assessment: { month: 10, skills: [{ label: 'Reading', rating: 4 }], behaviour: [{ label: 'Discipline', rating: 5 }], teacher_remark: 'Keep going' },
  grade_scales: [{ grade_label: 'B', min_percentage: 60, max_percentage: 79 }, { grade_label: 'A', min_percentage: 80, max_percentage: 100 }],
  promotion_applicable: true, promotion_status: 'PROMOTED', overall_comment: 'Fine term',
};
const html = (over: Partial<CardReport> = {}, template: 'enhanced' | 'traditional' = 'enhanced') =>
  renderReportCardHtml({ report: { ...base, ...over }, school: { address: '1 Main St', logo: 'https://x.test/l.png' }, template, today: '2026-11-03' });

describe('helpers', () => {
  it('escapes markup', () => expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;'));
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
    expect(positionText(3, 30)).toBe('3rd of 30');
    expect(positionText(3, null)).toBe('3rd');
  });
  it('lists the grade key highest band first', () => {
    expect(gradeKeyText(base.grade_scales)).toBe('Grade key:  A 80–100%   ·   B 60–79%');
    expect(gradeKeyText([])).toBe('');
  });
});

describe('enhanced layout', () => {
  const h = html();
  it('shows the school and student, and escapes their names', () => {
    expect(h).toContain('Demo School');
    expect(h).toContain('Report Card – Ayesha &lt;Khan&gt;');
    expect(h).not.toContain('<Khan>');
  });
  it('has position and overall tiles, the attendance panel and the logo', () => {
    expect(h).toContain('3rd of 30');
    expect(h).toContain('OVERALL');
    expect(h).toContain('17 / 20 days');
    expect(h).toContain('src="https://x.test/l.png"');
  });
  it('shows each subject with Pass or Fail, comments and the grade key', () => {
    expect(h).toContain('Maths');
    expect(h).toContain('>Pass<');
    expect(h).toContain('>Fail<');
    expect(h).toContain('Good &lt;work&gt;');
    expect(h).toContain('Grade key:');
  });
  it('shows promotion, ratings, remarks and the signatures', () => {
    expect(h).toContain('PROMOTED');
    expect(h).toContain('SKILLS &amp; BEHAVIOUR ASSESSMENT — OCTOBER');
    expect(h).toContain('Keep going');
    expect(h).toContain('CLASS TEACHER');
    expect(h).toContain('PRINCIPAL');
  });
});

describe('traditional layout', () => {
  const h = html({}, 'traditional');
  it('has the progress report heading, the info table and the double frame', () => {
    expect(h).toContain('PROGRESS REPORT · CYCLE TEST');
    expect(h).toContain('Class / Section');
    expect(h).toContain('Mr Khan');
    expect(h).toContain('border:1pt solid #17324f');
  });
  it('uses Max Marks and no Class Avg column, and Parent / Guardian for the last signature', () => {
    expect(h).toContain('Max Marks');
    expect(h).not.toContain('Class Avg');
    expect(h).toContain('PARENT / GUARDIAN');
  });
});

describe('edge cases', () => {
  it('prints a DRAFT banner and no promotion when it is not applicable', () => {
    const h = html({ is_draft: true, promotion_applicable: false });
    expect(h).toContain('DRAFT');
    expect(h).not.toContain('PROMOTION STATUS');
  });
  it('writes Absent and Abs in the right cells and shortens exam names', () => {
    const one = html({ subjects: [{ subject_id: 1, subject_name: 'Art', total_marks: 50, is_absent: true }] });
    expect(one).toContain('>Absent<');
    const two = html({
      exams: [exam(1, '1st Term Exam 2026-27 - Playgroup'), exam(2, 'Final', true, { 1: { is_absent: true, total_marks: 50 } })],
      subjects: [{ subject_id: 1, subject_name: 'Art', total_marks: 50 }],
    });
    expect(two).toContain('>Abs<');
    expect(two).toContain('1st Term Exam');
    expect(two).not.toContain('Playgroup');
  });
  it('leaves out the attendance panel with no working days and copes with no school', () => {
    const h = renderReportCardHtml({ report: { ...base, attendance: { working_days: 0 } }, school: null, template: 'enhanced', today: '2026-11-03' });
    expect(h).not.toContain('ATTENDANCE');
    expect(h).not.toContain('<img');
  });
  it('writes Urdu and other non-Latin names as they are', () => {
    expect(html({ student_name: 'عائشہ خان' })).toContain('Report Card – عائشہ خان');
  });
});
