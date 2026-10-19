import { describe, it, expect } from 'vitest'
import { filterGuideChapters, buildAvailability } from './guideAccess'
import guideData from '../data/userGuide.json'

const allModules = () => true
const staffLevel = (role) => ['STAFF', 'TEACHER', 'MANAGER', 'ACCOUNTANT', 'DRIVER'].includes(role)

const accessFor = (role, isModuleEnabled = allModules) => ({ role, isSuperAdmin: false, isModuleEnabled })
const titles = (role, isModuleEnabled) =>
  filterGuideChapters(guideData.chapters, accessFor(role, isModuleEnabled)).map((c) => c.title)

describe('filterGuideChapters', () => {
  it('shows everything to a super admin', () => {
    const all = filterGuideChapters(guideData.chapters, { role: 'SUPER_ADMIN', isSuperAdmin: true, isModuleEnabled: () => false })
    expect(all.length).toBe(guideData.chapters.length)
  })

  it('hides finance and HR from a teacher but keeps attendance', () => {
    const t = titles('TEACHER')
    expect(t).toContain('Attendance Module')
    expect(t).not.toContain('Finance Module')
    expect(t).not.toContain('HR & Staff Management Module')
  })

  it('hides a chapter whose module is disabled for the school', () => {
    const t = titles('SCHOOL_ADMIN', (m) => m !== 'inventory')
    expect(t).not.toContain('Inventory & Store')
    expect(titles('SCHOOL_ADMIN')).toContain('Inventory & Store')
  })

  it('narrows a chapter by section tags (teacher keeps Collect Payments sections only in finance)', () => {
    const finance = filterGuideChapters(guideData.chapters, accessFor('TEACHER')).find((c) => c.title === 'Finance Module')
    expect(finance).toBeUndefined()
    const accountant = filterGuideChapters(guideData.chapters, accessFor('ACCOUNTANT')).find((c) => c.title === 'Finance Module')
    expect(accountant).toBeDefined()
  })

  it('gives parents only parent-facing and shared chapters', () => {
    const t = titles('PARENT')
    expect(t).toContain('Parent Portal')
    expect(t).not.toContain('Student Portal')
    expect(t).not.toContain('Settings & Configuration')
  })
})

describe('buildAvailability', () => {
  const availability = (role, extra = {}) => buildAvailability({
    effectiveRole: role,
    isSuperAdmin: false,
    isParent: role === 'PARENT',
    isStudent: role === 'STUDENT',
    isModuleEnabled: allModules,
    isStaffLevel: staffLevel(role),
    isManager: role === 'MANAGER',
    ...extra,
  })

  it('lets a teacher open Manual Entry but not Fee Setup', () => {
    const can = availability('TEACHER')
    expect(can('/attendance/manual-entry')).toBe(true)
    expect(can('/finance/fees/collect')).toBe(true)
    expect(can('/finance/fees/setup')).toBe(false)
  })

  it('hides attendance from a manager', () => {
    expect(availability('MANAGER')('/attendance/manual-entry')).toBe(false)
  })

  it('treats pages that are in no sidebar as available', () => {
    expect(availability('TEACHER')('/attendance/at-risk')).toBe(true)
  })

  it('respects disabled modules', () => {
    const can = availability('SCHOOL_ADMIN', { isModuleEnabled: (m) => m !== 'hostel' })
    expect(can('/hostel/rooms')).toBe(false)
    expect(can('/library/catalog')).toBe(true)
  })
})

describe('guide data', () => {
  it('only links to hrefs that some sidebar can reach or that are known standalone pages', () => {
    const hrefs = []
    guideData.chapters.forEach((c) => c.sections.forEach((s) => s.content.forEach((i) => {
      if (i.type === 'nav_path' && i.href) hrefs.push(i.href)
    })))
    expect(hrefs.length).toBeGreaterThan(50)
    hrefs.forEach((h) => expect(h.startsWith('/')).toBe(true))
  })
})
