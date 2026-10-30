// Pure logic for authoring Question Bank entries; port of frontend/src/pages/examinations/QuestionsPage.jsx
// and the rules in backend/examinations/serializers.py (QuestionCreateUpdateSerializer). Admin,
// principal, teacher (own subjects only) and manager may write. Covers every question type
// (multiple choice, short, long, essay, true/false, fill in the blank, matching), curriculum topic
// tags, and pictures on the question, the options and the answer.

export const QUESTION_TYPES = [
  { value: 'MCQ', label: 'Multiple choice' }, { value: 'SHORT', label: 'Short answer' }, { value: 'LONG', label: 'Long answer' },
  { value: 'ESSAY', label: 'Essay' }, { value: 'TRUE_FALSE', label: 'True / False' }, { value: 'FILL_BLANK', label: 'Fill in the blank' },
  { value: 'MATCHING', label: 'Matching' },
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number]['value'];

export const DIFFICULTIES = [{ value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }] as const;

export const BLOOM_LEVELS = [
  { value: 'remember', label: 'Remember' }, { value: 'understand', label: 'Understand' }, { value: 'apply', label: 'Apply' },
  { value: 'analyze', label: 'Analyze' }, { value: 'evaluate', label: 'Evaluate' }, { value: 'create', label: 'Create' },
] as const;

export interface MatchingData { left_items?: string[]; right_items?: string[]; pairs?: Array<{ left: number; right: number }>; accepted_answers?: string[] }

export interface Question {
  id: number;
  subject: number;
  subject_name?: string;
  exam_type?: number | null;
  question_text: string;
  question_type: string;
  difficulty_level: string;
  bloom_level?: string | null;
  marks: number | string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: string;
  answer_text?: string;
  type_data?: MatchingData;
  tested_topics?: Array<number | { id: number }>;
  question_image_url?: string | null;
  option_a_image_url?: string | null;
  option_b_image_url?: string | null;
  option_c_image_url?: string | null;
  option_d_image_url?: string | null;
  answer_image_url?: string | null;
}

export interface QuestionForm {
  subject: number | null;
  type: QuestionType | string;
  text: string;
  marks: string;
  difficulty: string;
  bloom: string | null;
  a: string;
  b: string;
  c: string;
  d: string;
  correct: string;
  answer: string;
  topics: number[];
  // Matching: two columns of items and, for each left item, the index of its right partner.
  left: string[];
  right: string[];
  pairs: Array<number | null>;
}

export const emptyQuestionForm = (): QuestionForm => ({
  subject: null, type: 'SHORT', text: '', marks: '1', difficulty: 'MEDIUM', bloom: null, a: '', b: '', c: '', d: '', correct: '', answer: '',
  topics: [], left: ['', ''], right: ['', ''], pairs: [null, null],
});

const idOf = (t: number | { id: number }) => (typeof t === 'number' ? t : t.id);

export function questionToForm(q: Question): QuestionForm {
  const td = q.type_data ?? {};
  const left = td.left_items?.length ? td.left_items : ['', ''];
  const pairs: Array<number | null> = left.map((_, i) => td.pairs?.find((p) => p.left === i)?.right ?? null);
  return {
    subject: q.subject, type: q.question_type, text: q.question_text, marks: String(Number(q.marks)), difficulty: q.difficulty_level,
    bloom: q.bloom_level ?? null, a: q.option_a ?? '', b: q.option_b ?? '', c: q.option_c ?? '', d: q.option_d ?? '',
    correct: q.correct_answer ?? '',
    // Fill in the blank keeps its accepted answers in type_data, shown comma separated.
    answer: q.question_type === 'FILL_BLANK' && td.accepted_answers?.length ? td.accepted_answers.join(', ') : q.answer_text ?? '',
    topics: (q.tested_topics ?? []).map(idOf),
    left, right: td.right_items?.length ? td.right_items : ['', ''], pairs,
  };
}

export const isEditableType = (type: string) => QUESTION_TYPES.some((t) => t.value === type);

const filled = (items: string[]) => items.map((v, i) => ({ v: v.trim(), i })).filter((x) => x.v);

export function validateQuestion(f: QuestionForm): string | null {
  if (!f.subject) return 'Choose the subject.';
  if (!f.text.trim()) return 'Write the question.';
  if (!(Number(f.marks) > 0) || !Number.isFinite(Number(f.marks))) return 'Marks must be a number above zero.';
  if (f.type === 'MCQ') {
    if (!f.a.trim() || !f.b.trim()) return 'A multiple choice question needs at least options A and B.';
    const key = f.correct.trim().toUpperCase();
    if (key && !['A', 'B', 'C', 'D'].includes(key)) return 'The correct answer must be A, B, C or D.';
    const options: Record<string, string> = { A: f.a, B: f.b, C: f.c, D: f.d };
    if (key && !options[key].trim()) return `Option ${key} is the correct answer but is empty.`;
  }
  if (f.type === 'TRUE_FALSE' && !['true', 'false'].includes(f.correct.trim().toLowerCase())) return 'Choose True or False as the answer.';
  if (f.type === 'MATCHING') {
    if (filled(f.left).length < 2) return 'Matching needs at least two items on the left.';
    if (filled(f.right).length < 2) return 'Matching needs at least two items on the right.';
    if (matchingPairs(f).length < 2) return 'Match at least two left items to their partners.';
  }
  return null;
}

// Pairs between the items that were actually filled in, re-numbered to the trimmed lists the server gets.
export function matchingPairs(f: Pick<QuestionForm, 'left' | 'right' | 'pairs'>): Array<{ left: number; right: number }> {
  const left = filled(f.left);
  const right = filled(f.right);
  const out: Array<{ left: number; right: number }> = [];
  left.forEach((l, li) => {
    const partner = f.pairs[l.i];
    if (partner == null) return;
    const ri = right.findIndex((r) => r.i === partner);
    if (ri >= 0) out.push({ left: li, right: ri });
  });
  return out;
}

export function buildQuestionPayload(f: QuestionForm) {
  const mcq = f.type === 'MCQ';
  const base = {
    subject: f.subject,
    question_type: f.type,
    question_text: f.text.trim(),
    marks: Number(f.marks),
    difficulty_level: f.difficulty,
    bloom_level: f.bloom,
    option_a: mcq ? f.a.trim() : '',
    option_b: mcq ? f.b.trim() : '',
    option_c: mcq ? f.c.trim() : '',
    option_d: mcq ? f.d.trim() : '',
    // MCQ keeps A to D, true/false keeps TRUE or FALSE, the rest keep the typed answer key.
    correct_answer: mcq || f.type === 'TRUE_FALSE' ? f.correct.trim().toUpperCase() : f.type === 'MATCHING' ? '' : f.correct.trim(),
    answer_text: f.answer.trim(),
    tested_topics: f.topics,
  };
  if (f.type === 'MATCHING') {
    return { ...base, type_data: { left_items: filled(f.left).map((x) => x.v), right_items: filled(f.right).map((x) => x.v), pairs: matchingPairs(f) } };
  }
  if (f.type === 'FILL_BLANK') {
    return { ...base, correct_answer: '', type_data: { accepted_answers: f.answer.split(',').map((s) => s.trim()).filter(Boolean) } };
  }
  return base;
}

export const typeLabel = (t: string) => QUESTION_TYPES.find((x) => x.value === t)?.label ?? t;

export function difficultyTone(d: string): 'success' | 'warning' | 'error' | 'neutral' {
  return d === 'EASY' ? 'success' : d === 'MEDIUM' ? 'warning' : d === 'HARD' ? 'error' : 'neutral';
}

// ─── Pictures ──────────────────────────────────────────────────────────────────────────────

export type PictureSlot = 'question' | 'option_a' | 'option_b' | 'option_c' | 'option_d' | 'answer';

export const PICTURE_SLOTS: Array<{ slot: PictureSlot; label: string; field: keyof Question; mcqOnly?: boolean }> = [
  { slot: 'question', label: 'Question picture', field: 'question_image_url' },
  { slot: 'option_a', label: 'Option A picture', field: 'option_a_image_url', mcqOnly: true },
  { slot: 'option_b', label: 'Option B picture', field: 'option_b_image_url', mcqOnly: true },
  { slot: 'option_c', label: 'Option C picture', field: 'option_c_image_url', mcqOnly: true },
  { slot: 'option_d', label: 'Option D picture', field: 'option_d_image_url', mcqOnly: true },
  { slot: 'answer', label: 'Model answer picture', field: 'answer_image_url' },
];

// The slots that make sense for a type: option pictures only on multiple choice.
export const slotsFor = (type: string) => PICTURE_SLOTS.filter((s) => !s.mcqOnly || type === 'MCQ');

export const hasPicture = (q: Question | null | undefined, slot: PictureSlot): boolean => {
  const field = PICTURE_SLOTS.find((s) => s.slot === slot)?.field;
  return !!(q && field && q[field]);
};

export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;

export function pictureProblem(mime: string | undefined, size: number | undefined): string | null {
  if (mime && !PICTURE_TYPES.includes(mime)) return 'Use a JPEG, PNG or WebP picture.';
  if (size && size > PICTURE_MAX_BYTES) return 'The picture is larger than 5 MB.';
  return null;
}
