import {
  assessmentTitle, earlierBranchNote, hasAssessmentText, ratingLine, riskCards, riskTone, type AIProfile,
} from '../services/studentInsights';

const full: AIProfile = {
  left_school: false, overall_risk: 'MEDIUM', risk_score: 42,
  attendance: { risk: 'HIGH', trend: 'declining', insufficient_data: false },
  academic: { risk: 'LOW', weakest: 'Maths', insufficient_data: false },
  financial: { risk: 'MEDIUM', months_overdue: 2, insufficient_data: false },
  ai_summary: 'Attendance needs attention.',
  recommendations: ['Call the parents.'],
};

describe('riskTone', () => {
  it('maps the three levels and leaves anything else neutral', () => {
    expect(riskTone('LOW')).toBe('success');
    expect(riskTone('MEDIUM')).toBe('warning');
    expect(riskTone('HIGH')).toBe('error');
    expect(riskTone(null)).toBe('neutral');
    expect(riskTone('SOMETHING')).toBe('neutral');
  });
});

describe('riskCards', () => {
  it('shows attendance, academic, financial and the overall score, coloured by level', () => {
    const cards = riskCards(full);
    expect(cards.map((c) => [c.label, c.value, c.sub, c.tone])).toEqual([
      ['Attendance risk', 'High', 'Trend: declining', 'error'],
      ['Academic risk', 'Low', 'Weakest: Maths', 'success'],
      ['Financial risk', 'Medium', '2 months overdue', 'warning'],
      ['Overall risk score', '42%', null, 'warning'],
    ]);
  });

  it('leaves the financial tile out when the server did not send it', () => {
    const { financial: _f, ...noFees } = full;
    expect(riskCards(noFees).map((c) => c.label)).toEqual(['Attendance risk', 'Academic risk', 'Overall risk score']);
  });

  it('says there is not enough data instead of a risk, in neutral colour', () => {
    const cards = riskCards({ ...full, attendance: { insufficient_data: true }, academic: { insufficient_data: true, risk: null }, financial: { insufficient_data: true } });
    expect(cards[0]).toMatchObject({ value: 'Not enough data', sub: null, tone: 'neutral' });
    expect(cards[1]).toMatchObject({ value: 'Not enough data', tone: 'neutral' });
    expect(cards[2]).toMatchObject({ value: 'Not enough data', sub: null, tone: 'neutral' });
  });

  it('says one month, not one months', () => {
    expect(riskCards({ ...full, financial: { risk: 'LOW', months_overdue: 1 } })[2].sub).toBe('1 month overdue');
    expect(riskCards({ ...full, financial: { risk: 'LOW' } })[2].sub).toBe('0 months overdue');
  });

  it('shows a single tile for a student who has left', () => {
    expect(riskCards({ left_school: true, left_date: '2026-08-01' })).toEqual([{ label: 'Risk', value: 'Left school', sub: 'Since 2026-08-01', tone: 'neutral' }]);
    expect(riskCards({ left_school: true })[0].sub).toBeNull();
  });

  it('shows N/A for a missing score, and nothing at all for no profile', () => {
    expect(riskCards({ ...full, risk_score: null }).at(-1)?.value).toBe('N/A');
    expect(riskCards(null)).toEqual([]);
    expect(riskCards(undefined)).toEqual([]);
  });

  it('reads an underscored trend as words', () => {
    expect(riskCards({ ...full, attendance: { risk: 'LOW', trend: 'no_data' } })[0].sub).toBe('Trend: no data');
  });
});

describe('the assessment text', () => {
  it('is there when there is a summary or advice, and not for a student who left', () => {
    expect(hasAssessmentText(full)).toBe(true);
    expect(hasAssessmentText({ ai_summary: 'x' })).toBe(true);
    expect(hasAssessmentText({ recommendations: ['y'] })).toBe(true);
    expect(hasAssessmentText({ ai_summary: '', recommendations: [] })).toBe(false);
    expect(hasAssessmentText({ ...full, left_school: true })).toBe(false);
    expect(hasAssessmentText(null)).toBe(false);
  });
});

describe('earlier assessments', () => {
  it('titles a month with its year', () => {
    expect(assessmentTitle({ month: 3, academic_year_name: '2025-26' })).toBe('March · 2025-26');
    expect(assessmentTitle({ month: 12 })).toBe('December');
  });

  it('lists only the rated fields, by name and in words, in form order', () => {
    expect(ratingLine({ discipline: 5, listening: 3, writing: null, respect: 0 })).toBe('Listening: Good · Discipline: Excellent');
    expect(ratingLine({})).toBe('');
    expect(ratingLine(undefined)).toBe('');
  });

  it('shows an unknown rating number as it is', () => {
    expect(ratingLine({ listening: 9 })).toBe('Listening: 9');
  });
});

describe('earlierBranchNote', () => {
  it('names the earlier branches, or says an earlier branch', () => {
    expect(earlierBranchNote({ has_earlier_branch_data: true, earlier_branches: ['Branch 1', 'Branch 2'] })).toBe('Includes records from Branch 1, Branch 2 (read-only), so these figures cover everything that actually happened.');
    expect(earlierBranchNote({ has_earlier_branch_data: true })).toContain('an earlier branch');
  });

  it('is empty for a student who never moved', () => {
    expect(earlierBranchNote({ has_earlier_branch_data: false })).toBe('');
    expect(earlierBranchNote(null)).toBe('');
  });
});
