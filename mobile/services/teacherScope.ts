// Why a teacher can see a class or subject: the web's TeacherScopeBadge, as pure logic. A
// class-wide assignment (class teacher) or a subject assignment inside a class (subject teacher).

export type ScopeKind = 'class' | 'subject' | 'out';
export interface Scope { kind: ScopeKind; label: string; detail: string }

export interface ScopeLookup { classIds: Set<string>; classSubjects: Map<string, Set<string>> }

const norm = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function buildScopeLookup(
  classTeacher: Array<{ class_obj?: number | string | null }>,
  subjectTeacher: Array<{ class_obj?: number | string | null; subject?: number | string | null }>,
): ScopeLookup {
  const classIds = new Set<string>();
  const classSubjects = new Map<string, Set<string>>();
  classTeacher.forEach((item) => {
    const id = norm(item.class_obj);
    if (id) classIds.add(id);
  });
  subjectTeacher.forEach((item) => {
    const classId = norm(item.class_obj);
    const subjectId = norm(item.subject);
    if (!classId || !subjectId) return;
    if (!classSubjects.has(classId)) classSubjects.set(classId, new Set());
    classSubjects.get(classId)!.add(subjectId);
  });
  return { classIds, classSubjects };
}

export function resolveScope(lookup: ScopeLookup, classId: unknown, subjectId?: unknown): Scope | null {
  const c = norm(classId);
  const s = norm(subjectId);
  if (!c) return null;
  const hasClass = lookup.classIds.has(c);
  const subjects = lookup.classSubjects.get(c);
  const hasSubject = !!s && !!subjects?.has(s);

  if (hasClass) {
    return {
      kind: 'class', label: 'Class teacher',
      detail: hasSubject ? 'Visible through your class-wide assignment. You also hold the subject assignment.' : 'Visible through your class-wide assignment.',
    };
  }
  if (hasSubject) return { kind: 'subject', label: 'Subject teacher', detail: 'Visible only because this subject is assigned to you in this class.' };
  if (!s && subjects?.size) {
    return { kind: 'subject', label: 'Subject teacher', detail: 'This class is only partly visible. Pick one of your subjects to narrow it.' };
  }
  return {
    kind: 'out', label: 'Out of scope',
    detail: s ? 'This class and subject are not in your teacher assignments.' : 'This class is not in your teacher assignments.',
  };
}
