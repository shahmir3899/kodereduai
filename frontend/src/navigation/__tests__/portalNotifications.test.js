import { describe, it, expect } from 'vitest'
import { buildParentNavigation, buildStudentNavigation, collectNavHrefs, NO_ICONS } from '../navigationConfig'

// /notifications is open to portal accounts (Inbox tab only): the menu must lead there.
describe('portal navigation', () => {
  it('offers Notifications to parents', () => {
    expect(collectNavHrefs(buildParentNavigation(NO_ICONS))).toContain('/notifications')
  })
  it('offers Notifications to students', () => {
    expect(collectNavHrefs(buildStudentNavigation(NO_ICONS))).toContain('/notifications')
  })
})
