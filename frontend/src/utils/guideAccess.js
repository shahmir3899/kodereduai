// Role/module filtering and "Show me" availability for the User Guide page.
// Tags (`roles`, `module`, `href`) are written by generate_user_guide.py via
// guide_meta.py; a missing tag means "everyone" / "no module".
import {
  buildStaffNavigation,
  buildParentNavigation,
  buildStudentNavigation,
  collectNavHrefs,
  NO_ICONS,
} from '../navigation/navigationConfig'

export function isVisibleFor(tags, { role, isSuperAdmin, isModuleEnabled }) {
  if (isSuperAdmin) return true
  if (tags.roles && !tags.roles.includes(role)) return false
  if (tags.module && !isModuleEnabled(tags.module)) return false
  return true
}

// Chapters/sections the user can actually use. A chapter whose sections are all
// filtered out is dropped; a section inherits nothing from its chapter beyond
// the chapter being visible, so a section tag can only narrow its chapter.
export function filterGuideChapters(chapters, access) {
  return chapters
    .filter((chapter) => isVisibleFor(chapter, access))
    .map((chapter) => ({
      ...chapter,
      sections: chapter.sections.filter((section) => isVisibleFor(section, access)),
    }))
    .filter((chapter) => chapter.sections.length > 0)
}

const ADMIN_CTX = {
  effectiveRole: 'SCHOOL_ADMIN',
  isModuleEnabled: () => true,
  isStaffLevel: false,
  isManager: false,
  isTeacher: false,
  isStaff: false,
  isSchoolAdminNav: true,
  hasInventoryAssignments: true,
}

// href -> can this user open it from their sidebar? Pages that appear in no
// sidebar at all (for example links from dashboard widgets) are treated as
// available; the route guards still apply when they click.
export function buildAvailability({ effectiveRole, isSuperAdmin, isParent, isStudent, isModuleEnabled, isStaffLevel, isManager }) {
  const everything = new Set([
    ...collectNavHrefs(buildStaffNavigation(ADMIN_CTX, NO_ICONS)),
    ...collectNavHrefs(buildParentNavigation(NO_ICONS)),
    ...collectNavHrefs(buildStudentNavigation(NO_ICONS)),
  ])

  let mine
  if (isSuperAdmin) {
    mine = everything
  } else if (isParent) {
    mine = collectNavHrefs(buildParentNavigation(NO_ICONS))
  } else if (isStudent) {
    mine = collectNavHrefs(buildStudentNavigation(NO_ICONS))
  } else {
    mine = collectNavHrefs(buildStaffNavigation({
      effectiveRole,
      isModuleEnabled,
      isStaffLevel,
      isManager,
      isTeacher: effectiveRole === 'TEACHER',
      isStaff: effectiveRole === 'STAFF',
      isSchoolAdminNav: effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL',
      hasInventoryAssignments: true,
    }, NO_ICONS))
  }

  return (href) => !everything.has(href) || mine.has(href)
}
