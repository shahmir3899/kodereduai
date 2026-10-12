import { describe, it, expect } from 'vitest'
import {
  getBaseDomain,
  getSchoolSubdomain,
  isBaseSubdomain,
  isPortalHost,
  isStaticHost,
} from './domain'

describe('domain config', () => {
  it.each(['kodereduai.pk', 'educationai.pk', 'educationai.com.pk'])('school subdomain on %s', (d) => {
    expect(getSchoolSubdomain(`focus.${d}`)).toBe('focus')
    expect(isBaseSubdomain(`focus.${d}`)).toBe(true)
    expect(isPortalHost(`portal.${d}`)).toBe(true)
    expect(isStaticHost(d)).toBe(true)
    expect(isStaticHost(`www.${d}`)).toBe(true)
    expect(getBaseDomain(`demo.${d}`)).toBe(d)
  })

  it('does not treat www, nested labels or lookalike hosts as schools', () => {
    expect(getSchoolSubdomain('www.educationai.pk')).toBeNull()
    expect(getSchoolSubdomain('a.b.educationai.pk')).toBeNull()
    expect(getSchoolSubdomain('evil-educationai.pk')).toBeNull()
    expect(getSchoolSubdomain('educationai.pk.evil.com')).toBeNull()
    expect(getBaseDomain('localhost')).toBeNull()
  })
})
