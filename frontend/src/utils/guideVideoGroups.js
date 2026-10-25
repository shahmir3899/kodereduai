// How the Videos tab groups tutorials: by the job a person is trying to do, not by chapter number.
// Keyed by guide chapter so a new video in an existing chapter lands in the right group by itself.
export const VIDEO_GROUPS = [
  { id: 'start', title: 'Get started', chapters: [1, 2] },
  { id: 'attendance', title: 'Daily attendance', chapters: [3, 4] },
  { id: 'academics', title: 'Academics and lessons', chapters: [5, 12] },
  { id: 'exams', title: 'Exams and results', chapters: [6] },
  { id: 'fees', title: 'Fees and money', chapters: [7] },
  { id: 'staff', title: 'Staff and payroll', chapters: [8] },
  { id: 'admissions', title: 'Admissions', chapters: [9] },
  { id: 'facilities', title: 'Transport, library and hostel', chapters: [10, 11, 17] },
  { id: 'messages', title: 'Messages and notifications', chapters: [13, 14] },
  { id: 'portals', title: 'For parents and students', chapters: [15, 16] },
  { id: 'users', title: 'Users and store', chapters: [19, 21] },
]

const FALLBACK = { id: 'more', title: 'More videos' }

/** Videos in their given order, split into groups. Empty groups are dropped; an unmapped chapter goes to "More videos". */
export function groupVideos(videos) {
  const byChapter = new Map(VIDEO_GROUPS.flatMap((g) => g.chapters.map((c) => [c, g])))
  const buckets = new Map()
  videos.forEach((video) => {
    const group = byChapter.get(video.chapter) || FALLBACK
    if (!buckets.has(group.id)) buckets.set(group.id, { ...group, videos: [] })
    buckets.get(group.id).videos.push(video)
  })
  const order = [...VIDEO_GROUPS.map((g) => g.id), FALLBACK.id]
  return order.filter((id) => buckets.has(id)).map((id) => buckets.get(id))
}

/** The video that follows `videoId` inside its own group, or null at the end of the group. */
export function nextInGroup(videos, videoId) {
  const group = groupVideos(videos).find((g) => g.videos.some((v) => v.id === videoId))
  if (!group) return null
  const index = group.videos.findIndex((v) => v.id === videoId)
  return group.videos[index + 1] || null
}
