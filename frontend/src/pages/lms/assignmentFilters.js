/**
 * Client-side filter for the Assignments list. The page fetches the whole academic year once;
 * class/subject/status/type/search are applied here so changing a filter costs no API call.
 */
export function filterAssignments(assignments, {
  masterClassId, sessionClassId, sessionScoped, subject, status, type, search,
}) {
  const q = search ? search.toLowerCase() : ''
  return assignments.filter((a) => {
    if (masterClassId && String(a.class_obj) !== String(masterClassId)) return false
    // Whole-class assignments plus this section's own, not a sibling's.
    if (sessionScoped && sessionClassId && a.session_class != null
      && String(a.session_class) !== String(sessionClassId)) return false
    if (subject && String(a.subject) !== String(subject)) return false
    if (status && a.status !== status) return false
    if (type && a.assignment_type !== type) return false
    if (q && !a.title?.toLowerCase().includes(q)) return false
    return true
  })
}
