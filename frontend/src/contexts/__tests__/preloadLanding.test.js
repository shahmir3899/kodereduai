import { describe, it, expect } from 'vitest'
import { isPreloadLandingPath } from '../AuthContext'

describe('isPreloadLandingPath', () => {
  it.each(['/', '/dashboard', '/dashboard/', '/parent/dashboard', '/student/dashboard', '/admin', ''])(
    'warms the dashboard preload on %s',
    (path) => expect(isPreloadLandingPath(path)).toBe(true),
  )

  it.each(['/students', '/students/720', '/academics/subjects', '/academics/exams', '/finance', '/finance/fees/collect'])(
    'skips the dashboard preload on deep link %s',
    (path) => expect(isPreloadLandingPath(path)).toBe(false),
  )
})
