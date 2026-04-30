import { describe, it, expect } from 'vitest'
import {
  canAccessFinanceRoute,
  canAccessManagementRoute,
  canAccessInventoryRoute,
} from '../accessPolicies'

describe('accessPolicies', () => {
  describe('canAccessFinanceRoute', () => {
    it('allows teacher only on collect route', () => {
      expect(canAccessFinanceRoute('TEACHER', { collectOnly: true })).toBe(true)
      expect(canAccessFinanceRoute('TEACHER', { collectOnly: false })).toBe(false)
    })

    it('blocks staff from finance', () => {
      expect(canAccessFinanceRoute('STAFF', { collectOnly: true })).toBe(false)
      expect(canAccessFinanceRoute('STAFF', { collectOnly: false })).toBe(false)
    })

    it('allows admin roles', () => {
      expect(canAccessFinanceRoute('SCHOOL_ADMIN', { collectOnly: false })).toBe(true)
      expect(canAccessFinanceRoute('ACCOUNTANT', { collectOnly: false })).toBe(true)
    })
  })

  describe('canAccessManagementRoute', () => {
    it('allows teacher only when teacherAllowed is true', () => {
      expect(canAccessManagementRoute('TEACHER', { teacherAllowed: true })).toBe(true)
      expect(canAccessManagementRoute('TEACHER', { teacherAllowed: false })).toBe(false)
    })

    it('blocks staff from management', () => {
      expect(canAccessManagementRoute('STAFF', { teacherAllowed: true })).toBe(false)
    })
  })

  describe('canAccessInventoryRoute', () => {
    it('allows teacher/staff only on assignments route', () => {
      expect(canAccessInventoryRoute('TEACHER', { assignmentsOnly: true })).toBe(true)
      expect(canAccessInventoryRoute('TEACHER', { assignmentsOnly: false })).toBe(false)
      expect(canAccessInventoryRoute('STAFF', { assignmentsOnly: true })).toBe(true)
      expect(canAccessInventoryRoute('STAFF', { assignmentsOnly: false })).toBe(false)
    })

    it('allows non teacher/staff roles normally', () => {
      expect(canAccessInventoryRoute('SCHOOL_ADMIN', { assignmentsOnly: false })).toBe(true)
    })
  })
})
