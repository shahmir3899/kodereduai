import { describe, it, expect } from 'vitest'
import videoData from '../data/guideVideos.json'
import { groupVideos, nextInGroup, VIDEO_GROUPS } from './guideVideoGroups'

const ready = videoData.videos.filter((v) => v.status !== 'planned')

describe('guide video groups', () => {
  it('puts every recorded video in a named group, never in "More videos"', () => {
    const groups = groupVideos(ready)
    expect(groups.find((g) => g.id === 'more')?.videos.map((v) => v.id)).toBeUndefined()
    expect(groups.reduce((n, g) => n + g.videos.length, 0)).toBe(ready.length)
  })

  it('uses each chapter in one group only', () => {
    const chapters = VIDEO_GROUPS.flatMap((g) => g.chapters)
    expect(new Set(chapters).size).toBe(chapters.length)
  })

  it('keeps the order of the videos inside a group', () => {
    const exams = groupVideos(ready).find((g) => g.id === 'exams')
    const sections = exams.videos.map((v) => v.section)
    expect(sections).toEqual([...sections])
    expect(exams.videos.every((v) => v.chapter === 6)).toBe(true)
  })

  it('finds the next video in the same group, and none after the last', () => {
    const groups = groupVideos(ready)
    const group = groups.find((g) => g.videos.length > 1)
    expect(nextInGroup(ready, group.videos[0].id)?.id).toBe(group.videos[1].id)
    expect(nextInGroup(ready, group.videos[group.videos.length - 1].id)).toBeNull()
    expect(nextInGroup(ready, 'does-not-exist')).toBeNull()
  })
})
