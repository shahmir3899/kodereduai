// Pure helpers for the photo capture (ImageCapturePaperTab): how many pages, how many go up at once, each
// page slot's state and the capture's group id. No React here so it is cheap to test. The old review
// helpers (questions/sections from the removed questions scan) went in Paper Builder v2 Phase 7.

export const MAX_PAGES = 30
export const UPLOAD_CONCURRENCY = 3

/** Per-slot display state, merging what this browser knows with what the server reports. */
export function pageDisplayStatus(local, server) {
  if (local?.state === 'queued' || local?.state === 'uploading') return local.state
  if (!server || server.status === 'MISSING') return local?.state === 'failed' ? 'failed' : 'empty'
  if (server.status === 'EXTRACTED') return 'extracted'
  if (server.status === 'FAILED') return 'failed'
  return 'processing'
}

/** Client-made id that ties the pages of one capture together (the server accepts any uuid). */
export function newGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
