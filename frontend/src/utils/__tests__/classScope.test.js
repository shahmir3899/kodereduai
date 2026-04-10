import { describe, expect, it } from 'vitest'
import {
  buildSessionClassOptions,
  buildSessionLabeledMasterClassOptions,
} from '../classScope'

describe('classScope utilities', () => {
  describe('buildSessionClassOptions', () => {
    it('returns options sorted by grade_level → section → name', () => {
      const sessionClasses = [
        { id: 10, class_obj: 1, display_name: 'Class 2', section: 'B', grade_level: 6, is_active: true },
        { id: 11, class_obj: 2, display_name: 'Nursery', section: '', grade_level: 1, is_active: true },
        { id: 12, class_obj: 3, display_name: 'Class 2', section: 'A', grade_level: 6, is_active: true },
        { id: 13, class_obj: 4, display_name: 'Prep', section: '', grade_level: 2, is_active: true },
      ]

      const options = buildSessionClassOptions(sessionClasses)

      expect(options.map(o => o.label)).toEqual([
        'Nursery',
        'Prep',
        'Class 2 - A',
        'Class 2 - B',
      ])
    })

    it('filters out inactive session classes', () => {
      const sessionClasses = [
        { id: 10, class_obj: 1, display_name: 'Class 1', section: '', grade_level: 3, is_active: true },
        { id: 11, class_obj: 2, display_name: 'Class 2', section: '', grade_level: 4, is_active: false },
      ]

      const options = buildSessionClassOptions(sessionClasses)

      expect(options).toHaveLength(1)
      expect(options[0].name).toBe('Class 1')
    })
  })

  describe('buildSessionLabeledMasterClassOptions', () => {
    it('returns options sorted by grade_level → section → name', () => {
      const sessionClasses = [
        { id: 20, class_obj: 5, class_obj_name: 'Class 3', section: '', grade_level: 7, is_active: true },
        { id: 21, class_obj: 1, class_obj_name: 'Playgroup', section: '', grade_level: 0, is_active: true },
        { id: 22, class_obj: 3, class_obj_name: 'Class 1', section: 'B', grade_level: 5, is_active: true },
        { id: 23, class_obj: 3, class_obj_name: 'Class 1', section: 'A', grade_level: 5, is_active: true },
      ]

      const masterClasses = [
        { id: 1, name: 'Playgroup', section: '', grade_level: 0, is_active: true },
        { id: 3, name: 'Class 1', section: '', grade_level: 5, is_active: true },
        { id: 5, name: 'Class 3', section: '', grade_level: 7, is_active: true },
      ]

      const options = buildSessionLabeledMasterClassOptions({
        sessionClasses,
        masterClasses,
      })

      // Grade 0 first, then grade 5, then grade 7
      expect(options.map(o => o.name)).toEqual([
        'Playgroup',
        'Class 1',
        'Class 3',
      ])
      expect(options[0].grade_level).toBe(0)
      expect(options[1].grade_level).toBe(5)
      expect(options[2].grade_level).toBe(7)
    })

    it('includes master classes not linked to session classes', () => {
      const sessionClasses = [
        { id: 20, class_obj: 1, class_obj_name: 'Prep', section: '', grade_level: 2, is_active: true },
      ]

      const masterClasses = [
        { id: 1, name: 'Prep', section: '', grade_level: 2, is_active: true },
        { id: 2, name: 'Nursery', section: '', grade_level: 1, is_active: true },
      ]

      const options = buildSessionLabeledMasterClassOptions({
        sessionClasses,
        masterClasses,
        sessionScopedOnly: false,
      })

      // Both should be included, Nursery first by grade
      expect(options.map(o => o.name)).toEqual(['Nursery', 'Prep'])
    })

    it('sessionScopedOnly excludes master classes without session variants', () => {
      const sessionClasses = [
        { id: 20, class_obj: 1, class_obj_name: 'Prep', section: '', grade_level: 2, is_active: true },
      ]

      const masterClasses = [
        { id: 1, name: 'Prep', section: '', grade_level: 2, is_active: true },
        { id: 2, name: 'Nursery', section: '', grade_level: 1, is_active: true },
      ]

      const options = buildSessionLabeledMasterClassOptions({
        sessionClasses,
        masterClasses,
        sessionScopedOnly: true,
      })

      expect(options).toHaveLength(1)
      expect(options[0].name).toBe('Prep')
    })
  })
})
