import fs from 'fs';
import path from 'path';
import { buildQuestionPayload, emptyQuestionForm, type QuestionForm } from '../services/questionBank';

// Web is the reference: docs/paper-contract/fixtures.json pins what web sent for each question. Since Paper Builder v2
// Phase 7 the paper itself is a block list on both (the old picked-questions builder is gone), so only the question
// bank payload is compared here: the phone's question form must send the same fields as the web.
// Every difference mobile still has is listed in KNOWN_GAPS; a new or changed difference fails this test.
const { fixtures } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/paper-contract/fixtures.json'), 'utf8'));

const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));

function diff(a: unknown, b: unknown, at: string, out: string[]) {
  const x = strip(a) as any; const y = strip(b) as any;
  if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], `${at}.${k}`, out);
  } else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(at);
}

function formFor(q: any): QuestionForm {
  const td = q.type_data ?? {};
  return {
    ...emptyQuestionForm(), subject: 2, type: q.question_type, text: q.question_text, marks: String(q.marks), difficulty: q.difficulty_level,
    a: q.options.A, b: q.options.B, c: q.options.C, d: q.options.D, correct: q.correct_answer, answer: q.answer_text, blanks: td.items?.length ? td.items : [''],
    left: td.left_items ?? ['', ''], right: td.right_items ?? ['', ''], pairs: (td.left_items ?? ['', '']).map((_: string, i: number) => (td.pairs ?? []).find((p: any) => p.left === i)?.right ?? null),
  };
}

const QUESTION_FIELDS = ['question_text', 'question_type', 'difficulty_level', 'marks', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'answer_text', 'type_data'];

function gaps(): string[] {
  const out: string[] = [];
  for (const f of fixtures) {
    f.expected.manual_questions.forEach((exp: any, i: number) => {
      const sent = buildQuestionPayload(formFor(f.questions[i])) as any;
      // An empty type_data and no type_data are the same thing to the server.
      for (const o of [sent, exp]) if (o.type_data && !Object.keys(o.type_data).length) delete o.type_data;
      for (const k of QUESTION_FIELDS) { const dd: string[] = []; diff(sent[k], exp[k], k, dd); if (dd.length) out.push(`${f.name}:question.${k}`); }
    });
  }
  return [...new Set(out)].sort();
}

// Phase 1 closed G1 (marks_override), G3 (true/false casing) and G4 (total_marks); Phase 3 closed G2 (fill in the blank).
const KNOWN_GAPS: string[] = [];

describe('paper contract: mobile vs web', () => {
  it('differs from web only where KNOWN_GAPS says so', () => {
    expect(gaps()).toEqual([...KNOWN_GAPS].sort());
  });
});
