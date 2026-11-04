import { describe, expect, it } from 'vitest'
import { isPortrait, pickVariant, videoFile, videoSeconds, videoUrl } from './guideAssets'

const video = { id: 'x', seconds: { en: 60, ur: 70 }, mobile: { en: 100, ur: 110 } }

describe('guide video variants', () => {
  it('uses the portrait file on phones once it exists', () => {
    expect(videoFile(video, 'ur', 'mp4', 'mobile')).toBe('x.ur.m.mp4')
    expect(videoSeconds(video, 'ur', 'mobile')).toBe(110)
  })
  it('keeps the widescreen file on desktop', () => {
    expect(videoFile(video, 'en', 'vtt', 'desktop')).toBe('x.en.vtt')
    expect(videoSeconds(video, 'en', 'desktop')).toBe(60)
  })
  it('falls back to widescreen on phones until the portrait video is published', () => {
    const plain = { id: 'y', seconds: { en: 50 } }
    expect(videoFile(plain, 'en', 'mp4', 'mobile')).toBe('y.en.mp4')
    expect(videoSeconds(plain, 'en', 'mobile')).toBe(50)
  })
  it('app viewers prefer the app recording, then portrait, then widescreen', () => {
    const withApp = { ...video, variants: { app: { en: 40 } } }
    expect(pickVariant(withApp, 'app')).toBe('app')
    expect(videoFile(withApp, 'ur', 'poster.jpg', 'app')).toBe('x.ur.a.poster.jpg')
    expect(videoSeconds(withApp, 'ur', 'app')).toBe(40)
    expect(pickVariant(video, 'app')).toBe('mobile')
    expect(pickVariant({ id: 'z', seconds: { en: 1 } }, 'app')).toBe('desktop')
  })
  it('desktop viewers never get a phone recording', () => {
    expect(pickVariant({ ...video, variants: { app: { en: 40 } } }, 'desktop')).toBe('desktop')
    expect(isPortrait('desktop')).toBe(false)
    expect(isPortrait('app')).toBe(true)
  })
  it('builds urls under /guide', () => {
    expect(videoUrl('x.en.mp4')).toBe('/guide/x.en.mp4')
  })
})
