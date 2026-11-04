import fs from 'fs';
import path from 'path';
import {
  buildAutosavePayload, buildEnsurePayload, emptyPaperForm, hydrateStructure, type PickedQuestion,
} from '../services/paperBuilder';
import { buildQuestionPayload, emptyQuestionForm, type QuestionForm } from '../services/questionBank';

// Web is the reference (frontend/.../paperPayload.js, pinned by paperPayload.contract.test.js on the same file).
// Every difference mobile still has is listed in KNOWN_GAPS: when a phase fixes one, delete it from the list;
// a new or changed difference fails this test.
const { fixtures } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/paper-contract/fixtures.json'), 'utf8'));

const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));

function diff(a: unknown, b: unknown, at: string, out: string[]) {
  const x = strip(a) as any; const y = strip(b) as any;
  if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], `${at}.${k}`, out);
  } else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(at);
}

function mobileFor(f: any) {
  const s = f.setup;
  const form = { ...emptyPaperForm(), title: s.paper_title, classObj: s.class_obj, subject: s.subject, exam: s.exam, duration: s.duration_minutes,
    instructions: s.instructions, answerLines: !!s.render_options.answer_lines, totalMarks: s.total_marks };
  const sections = hydrateStructure(f.expected.ensure.structure);
  const picked: PickedQuestion[] = f.questions.map((q: any, i: number) => ({
    question: i + 1, text: q.question_text, type: q.question_type, bankMarks: q.marks, override: '', sectionKey: q.section_key, bloom: null,
  }));
  return { form, sections, picked };
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
    const { form, sections, picked } = mobileFor(f);
    const ensure = buildEnsurePayload(form, picked, sections);
    const d: string[] = [];
    diff(ensure, f.expected.ensure, 'ensure', d);
    out.push(...d.map((x) => `${f.name}:${x}`));
    const mq = buildAutosavePayload(form, picked, sections).manual_questions;
    f.expected.manual_questions.forEach((exp: any, i: number) => {
      const got: any = mq[i] ?? {};
      for (const k of ['question_order', 'section_key', 'marks_override']) { const dd: string[] = []; diff(got[k], exp[k], k, dd); if (dd.length) out.push(`${f.name}:manual_questions.${k}`); }
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
