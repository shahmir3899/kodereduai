import { describe, expect, it } from 'vitest'
import { videoFile, videoSeconds } from './guideAssets'

const video = { id: 'x', seconds: { en: 60, ur: 70 }, mobile: { en: 100, ur: 110 } }

describe('guide video variants', () => {
  it('uses the portrait file on phones once it exists', () => {
    expect(videoFile(video, 'ur', 'mp4', true)).toBe('x.ur.m.mp4')
    expect(videoSeconds(video, 'ur', true)).toBe(110)
  })
  it('keeps the widescreen file on desktop', () => {
    expect(videoFile(video, 'en', 'vtt', false)).toBe('x.en.vtt')
    expect(videoSeconds(video, 'en', false)).toBe(60)
  })
  it('falls back to widescreen on phones until the portrait video is published', () => {
    const plain = { id: 'y', seconds: { en: 50 } }
    expect(videoFile(plain, 'en', 'mp4', true)).toBe('y.en.mp4')
    expect(videoSeconds(plain, 'en', true)).toBe(50)
  })
})
