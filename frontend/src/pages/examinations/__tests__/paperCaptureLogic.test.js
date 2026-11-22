import { describe, expect, it } from 'vitest'
import { newGroupId, pageDisplayStatus } from '../paperCaptureLogic'

describe('photo capture helpers', () => {
  it('merges local and server page state', () => {
    expect(pageDisplayStatus({ state: 'uploading' }, { status: 'EXTRACTED' })).toBe('uploading')
    expect(pageDisplayStatus(undefined, { status: 'MISSING' })).toBe('empty')
    expect(pageDisplayStatus({ state: 'failed' }, { status: 'MISSING' })).toBe('failed')
    expect(pageDisplayStatus(undefined, { status: 'PROCESSING' })).toBe('processing')
    expect(pageDisplayStatus(undefined, { status: 'FAILED' })).toBe('failed')
    expect(pageDisplayStatus(undefined, { status: 'EXTRACTED' })).toBe('extracted')
  })

  it('makes a uuid for the capture group', () => {
    expect(newGroupId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
