import { describe, it, expect } from 'vitest'
import guide from '../data/userGuide.json'
import videoData from '../data/guideVideos.json'

const sections = guide.chapters.flatMap((c) => c.sections)
const videos = videoData.videos

// One recording may be shown in two guide sections (Setup and Academics), but under one id,
// so watching it once counts once.
describe('guide data', () => {
  it('has unique video ids and one video per section', () => {
    expect(new Set(videos.map((v) => v.id)).size).toBe(videos.length)
    expect(new Set(videos.map((v) => v.section)).size).toBe(videos.length)
  })

  it('points every section video at a listed video', () => {
    const ids = new Set(videos.map((v) => v.id))
    sections.filter((s) => s.video).forEach((s) => expect(ids.has(s.video), `${s.id} -> ${s.video}`).toBe(true))
  })

  it('places every video in a real guide section', () => {
    const ids = new Set(sections.map((s) => s.id))
    videos.forEach((v) => expect(ids.has(v.section), `${v.id} -> ${v.section}`).toBe(true))
  })
})
