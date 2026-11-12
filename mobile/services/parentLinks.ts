// Pure logic for the admin "Parent links" sheet: who is linked to a student, who can still be linked,
// and the request bodies. One parent can have several children (siblings), so linking is parent -> students.

export interface ParentProfile { id: number; full_name?: string; username?: string; phone?: string }
export interface ParentChildRow { link_id: number; student_id: number; student_name: string; class_name?: string; relation: string; is_primary: boolean }
export interface ParentEntry { parent: ParentProfile; children: ParentChildRow[]; child_count: number }
export interface Invite { id: number; invite_code: string; relation: string }
export interface SiblingSuggestion { student_id: number; student_name: string; class_name?: string }

export const parentName = (p: ParentProfile) => p.full_name || p.username || 'Parent';

export function linkedParentsOf(entries: ParentEntry[], studentId: number) {
  return entries
    .map((e) => ({ parent: e.parent, link: e.children.find((c) => c.student_id === studentId) }))
    .filter((x): x is { parent: ParentProfile; link: ParentChildRow } => !!x.link);
}

// Parents not yet linked to this student, as picker options that show how many children each already has.
export function linkableParentOptions(entries: ParentEntry[], studentId: number) {
  const linked = new Set(linkedParentsOf(entries, studentId).map((x) => x.parent.id));
  return entries
    .filter((e) => !linked.has(e.parent.id))
    .map((e) => ({
      value: e.parent.id,
      label: `${parentName(e.parent)}${e.parent.phone ? ` · ${e.parent.phone}` : ''} (${e.child_count} ${e.child_count === 1 ? 'child' : 'children'})`,
    }));
}

export function buildLinkPayload(parentId: number, studentIds: number[], relation: string, isPrimary = false) {
  return { parent_profile_id: parentId, student_ids: studentIds, relation, is_primary: isPrimary };
}

export function toggleId(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function linkSummary(linked: number): string {
  return linked === 1 ? '1 parent linked' : linked > 1 ? `${linked} parents linked` : 'No parent linked';
}
