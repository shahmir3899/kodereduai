// Daily Diary: one DIARY entry per subject of a class for a date, written as drafts. Same payload
// as the web's "Create Daily Diary" (it goes through the ordinary assignment create call). Pure
// logic, no React imports.

export interface DiarySubject { id: number; name: string; code?: string | null }

// Class-subject rows repeat a subject (one row per teacher or section), so list each subject once.
export function uniqueSubjects(
  rows: Array<{ subject: number; subject_name?: string; subject_code?: string | null }>,
): DiarySubject[] {
  const seen = new Set<number>();
  const out: DiarySubject[] = [];
  rows.forEach((r) => {
    if (!r.subject || seen.has(r.subject)) return;
    seen.add(r.subject);
    out.push({ id: r.subject, name: r.subject_name || `Subject ${r.subject}`, code: r.subject_code ?? null });
  });
  return out;
}

// The subjects that have text, in the list's order; a blank box is left out, as on the web.
export function filledEntries(subjects: DiarySubject[], details: Record<number, string>) {
  return subjects
    .map((subject) => ({ subject, details: (details[subject.id] ?? '').trim() }))
    .filter((e) => e.details !== '');
}

export function validateDiary(
  classId: number | null, date: string, entries: unknown[], teacherId: number | null, teacherRequired = true,
): string | null {
  if (!classId) return 'Please select a class';
  if (teacherRequired && !teacherId) return 'Please select a teacher';
  if (!date) return 'Please pick a date';
  if (entries.length === 0) return 'Write the diary for at least one subject';
  return null;
}

export function buildDiaryPayloads(input: {
  entries: Array<{ subject: DiarySubject; details: string }>;
  date: string;
  masterClassId: number;
  sessionClassId: number | null;
  // The server needs a teacher on every assignment; the web's diary payload leaves it out and is refused.
  // A manager passes null: the server then uses the subject's assigned teacher.
  teacherId: number | null;
  academicYearId?: number | null;
}) {
  return input.entries.map(({ subject, details }) => ({
    class_obj: input.masterClassId,
    session_class: input.sessionClassId,
    subject: subject.id,
    ...(input.teacherId ? { teacher: input.teacherId } : {}),
    title: `${subject.name} Diary - ${input.date}`,
    description: details,
    instructions: details,
    assignment_type: 'DIARY',
    requires_submission: false,
    due_date: input.date,
    total_marks: 0,
    attachments_allowed: false,
    status: 'DRAFT',
    ...(input.academicYearId ? { academic_year: input.academicYearId } : {}),
  }));
}

// Entries are created one at a time so a failure can say which subjects were saved.
export function diaryResultText(saved: string[], failed: string[]): string {
  if (failed.length === 0) return `Daily diary saved as drafts for ${saved.length} subject${saved.length === 1 ? '' : 's'}.`;
  if (saved.length === 0) return `Could not save the diary for ${failed.join(', ')}.`;
  return `Saved ${saved.join(', ')}. Could not save ${failed.join(', ')}; tap Save again to retry those.`;
}
