import { describe, expect, it } from 'vitest'
import { pickVoice, scriptOf } from '../useSpeech'

const v = (lang) => ({ lang, name: lang })

describe('scriptOf', () => {
  it('detects Urdu script and treats everything else as English', () => {
    expect(scriptOf('کلاس 5 کی فیس')).toBe('ur')
    expect(scriptOf('Class 5 fee')).toBe('en')
    expect(scriptOf('class 5 ki fee baqaya hai')).toBe('en')         // Roman Urdu is converted to Urdu script by the server first
    expect(scriptOf('Ali علی')).toBe('ur')
    expect(scriptOf('')).toBe('en')
  })
})

describe('pickVoice', () => {
  it('prefers Pakistan, then India, then any Urdu voice', () => {
    expect(pickVoice([v('ur-IN'), v('ur-PK'), v('en-US')], 'ur').lang).toBe('ur-PK')
    expect(pickVoice([v('en-US'), v('ur-IN')], 'ur').lang).toBe('ur-IN')
    expect(pickVoice([v('en-US'), v('ur-XX')], 'ur').lang).toBe('ur-XX')
  })

  it('has no fallback for Urdu: an English voice must not read Urdu script', () => {
    expect(pickVoice([v('en-US'), v('hi-IN')], 'ur')).toBeNull()
    expect(pickVoice([], 'ur')).toBeNull()
  })

  it('prefers a regional English voice that suits the audience', () => {
    expect(pickVoice([v('en-US'), v('en-IN'), v('en-GB')], 'en').lang).toBe('en-IN')
    expect(pickVoice([v('en-US'), v('en-GB')], 'en').lang).toBe('en-GB')
    expect(pickVoice([v('en-AU')], 'en').lang).toBe('en-AU')
    expect(pickVoice([v('ur-PK')], 'en')).toBeNull()
  })

  it('matches language codes case-insensitively', () => {
    expect(pickVoice([v('UR-pk')], 'ur').lang).toBe('UR-pk')
  })
})
