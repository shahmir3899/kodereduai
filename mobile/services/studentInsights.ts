import { BEHAVIOUR_FIELDS, MONTH_NAMES, RATING_LABELS, SKILL_FIELDS } from './assessments';

// Two read-only extras on a student's profile: the risk profile the server works out (attendance,
// marks, fees and an overall score, with a short summary and what to do), and the skills and
// behaviour ratings recorded at an earlier branch. Port of the Overview tab in
// frontend/src/pages/students/profile/ProfileTabs.jsx and StudentProfilePage.jsx. Pure logic.

export type RiskTone = 'success' | 'warning' | 'error' | 'neutral';

export interface AIProfile {
  left_school?: boolean;
  left_date?: string | null;
  overall_risk?: string | null;
  risk_score?: number | null;
  fees_hidden?: boolean;
  earlier_branches?: string[];
  attendance?: { risk?: string | null; trend?: string; insufficient_data?: boolean } | null;
  academic?: { risk?: string | null; weakest?: string | null; insufficient_data?: boolean } | null;
  financial?: { risk?: string | null; months_overdue?: number; insufficient_data?: boolean } | null;
  ai_summary?: string | null;
  recommendations?: string[];
}

export function riskTone(level: string | null | undefined): RiskTone {
  if (level === 'LOW') return 'success';
  if (level === 'MEDIUM') return 'warning';
  if (level === 'HIGH') return 'error';
  return 'neutral';
}

export interface RiskCard { label: string; value: string; sub?: string | null; tone: RiskTone }

const NOT_ENOUGH = 'Not enough data';
const title = (s: string | null | undefined) => (s ? s[0] + s.slice(1).toLowerCase() : '');

// The tiles under "Risk profile". A student who has left shows one tile saying so. The financial tile
// is there only when the server sent it (it leaves fees out for roles that cannot see them).
export function riskCards(ai: AIProfile | null | undefined): RiskCard[] {
  if (!ai) return [];
  if (ai.left_school) return [{ label: 'Risk', value: 'Left school', sub: ai.left_date ? `Since ${ai.left_date}` : null, tone: 'neutral' }];
  const cards: RiskCard[] = [];
  if (ai.attendance) {
    cards.push({
      label: 'Attendance risk',
      value: ai.attendance.insufficient_data ? NOT_ENOUGH : title(ai.attendance.risk) || 'N/A',
      sub: ai.attendance.insufficient_data || !ai.attendance.trend ? null : `Trend: ${ai.attendance.trend.replace(/_/g, ' ')}`,
      tone: ai.attendance.insufficient_data ? 'neutral' : riskTone(ai.attendance.risk),
    });
    cards.push({
      label: 'Academic risk',
      value: ai.academic?.insufficient_data ? NOT_ENOUGH : title(ai.academic?.risk) || 'N/A',
      sub: ai.academic?.weakest ? `Weakest: ${ai.academic.weakest}` : null,
      tone: ai.academic?.insufficient_data ? 'neutral' : riskTone(ai.academic?.risk),
    });
    if (ai.financial) {
      const m = ai.financial.months_overdue ?? 0;
      cards.push({
        label: 'Financial risk',
        value: ai.financial.insufficient_data ? NOT_ENOUGH : title(ai.financial.risk) || 'N/A',
        sub: ai.financial.insufficient_data ? null : `${m} month${m === 1 ? '' : 's'} overdue`,
        tone: ai.financial.insufficient_data ? 'neutral' : riskTone(ai.financial.risk),
      });
    }
    cards.push({ label: 'Overall risk score', value: ai.risk_score != null ? `${ai.risk_score}%` : 'N/A', sub: null, tone: riskTone(ai.overall_risk) });
  }
  return cards;
}

// Nothing to say (no summary and no advice) means the card is left out.
export const hasAssessmentText = (ai: AIProfile | null | undefined): boolean => !!ai && !ai.left_school && (!!ai.ai_summary || (ai.recommendations?.length ?? 0) > 0);

// ── Earlier branches ──────────────────────────────────────────────────────────

export interface EarlierAssessment {
  id: number;
  academic_year_name?: string;
  month: number;
  branch?: string | null;
  ratings?: Record<string, number | null | undefined>;
  teacher_remark?: string;
  principal_remark?: string;
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries([...SKILL_FIELDS, ...BEHAVIOUR_FIELDS]);

// "March · 2025-26".
export function assessmentTitle(a: Pick<EarlierAssessment, 'month' | 'academic_year_name'>): string {
  return [MONTH_NAMES[a.month - 1], a.academic_year_name].filter(Boolean).join(' · ');
}

// "Listening: Good · Discipline: Excellent": only fields that were rated, in the order the form lists them.
export function ratingLine(ratings: EarlierAssessment['ratings']): string {
  const r = ratings ?? {};
  return [...SKILL_FIELDS, ...BEHAVIOUR_FIELDS]
    .map(([key]) => [key, r[key]] as const)
    .filter(([, v]) => !!v)
    .map(([key, v]) => `${FIELD_LABELS[key] ?? key}: ${RATING_LABELS[Number(v)] ?? v}`)
    .join(' · ');
}

// Under the cards of a student who came from, or was also at, another branch.
export function earlierBranchNote(summary: { has_earlier_branch_data?: boolean; earlier_branches?: string[] } | null | undefined): string {
  if (!summary?.has_earlier_branch_data) return '';
  const where = (summary.earlier_branches ?? []).join(', ') || 'an earlier branch';
  return `Includes records from ${where} (read-only), so these figures cover everything that actually happened.`;
}
