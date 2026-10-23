import { describe, it, expect } from 'vitest'
import { buildStaffNavigation } from '../navigationConfig'

const NO_ICONS = new Proxy({}, { get: () => null })

function hrefs(entries) {
  return entries.flatMap((e) => (e.children ? hrefs(e.children) : e.href ? [e.href] : []))
}

function navFor(role, extra = {}) {
  return hrefs(buildStaffNavigation({
    effectiveRole: role,
    isModuleEnabled: () => true,
    isStaffLevel: role !== 'SCHOOL_ADMIN' && role !== 'PRINCIPAL',
    isManager: role === 'MANAGER',
    isTeacher: role === 'TEACHER',
    isStaff: role === 'STAFF',
    isDriver: role === 'DRIVER',
    isSchoolAdminNav: role === 'SCHOOL_ADMIN' || role === 'PRINCIPAL',
    hasInventoryAssignments: true,
    ...extra,
  }, NO_ICONS))
}

describe('driver navigation', () => {
  const nav = navFor('DRIVER')

  it('offers the driver their own pages', () => {
    expect(nav).toEqual(expect.arrayContaining(['/dashboard', '/transport', '/hr/self-service', '/notifications', '/messages', '/guide']))
  })

  it.each(['/finance', '/students', '/classes', '/academics/subjects', '/attendance/register', '/inventory/items'])(
    'does not show %s, whose API a driver may not use', (href) => {
      expect(nav).not.toContain(href)
    },
  )
})

describe('face attendance', () => {
  it('is an admin page: teachers see manual entry and the register but not face attendance', () => {
    const teacher = navFor('TEACHER')
    expect(teacher).toContain('/attendance/manual-entry')
    expect(teacher).not.toContain('/face-attendance')
    expect(navFor('SCHOOL_ADMIN')).toContain('/face-attendance')
  })
})
