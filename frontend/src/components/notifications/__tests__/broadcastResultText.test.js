import { describe, it, expect } from 'vitest'
import { broadcastResultText } from '../notificationMeta'

describe('broadcastResultText', () => {
  it('uses the singular for one recipient', () => {
    expect(broadcastResultText({ sent: 1, skipped: 0, failed: 0 })).toBe('Sent to 1 recipient (0 skipped, 0 failed)')
  })
  it('uses the plural otherwise', () => {
    expect(broadcastResultText({ sent: 5, skipped: 1, failed: 0 })).toBe('Sent to 5 recipients (1 skipped, 0 failed)')
    expect(broadcastResultText({ sent: 0, skipped: 2, failed: 1 })).toBe('Sent to 0 recipients (2 skipped, 1 failed)')
  })
})
