import { describe, it, expect, vi } from 'vitest'
import {
  headTurnRatio, classifyHeadTurn, poseVerdict, enrollSamplesSequentially,
  SAMPLE_POSES,
} from '../enrollSamples'

// 68-point array with just the three landmarks the head-turn ratio reads.
function landmarks({ jawStart = 0, jawEnd = 100, nose }) {
  const positions = Array.from({ length: 68 }, () => ({ x: 50, y: 50 }))
  positions[0] = { x: jawStart, y: 50 }
  positions[16] = { x: jawEnd, y: 50 }
  positions[30] = { x: nose, y: 50 }
  return positions
}

describe('headTurnRatio / classifyHeadTurn', () => {
  it('reads ~0.5 for a face looking at the camera', () => {
    expect(headTurnRatio(landmarks({ nose: 50 }))).toBeCloseTo(0.5)
    expect(classifyHeadTurn(0.5)).toBe('front')
  })

  it("treats the nose moving toward the image's right as a turn to the subject's LEFT", () => {
    // Raw camera image: the subject's left is on the image's right.
    expect(classifyHeadTurn(headTurnRatio(landmarks({ nose: 68 })))).toBe('left')
    expect(classifyHeadTurn(headTurnRatio(landmarks({ nose: 32 })))).toBe('right')
  })

  it('calls an in-between angle neither front nor a side', () => {
    expect(classifyHeadTurn(0.59)).toBe('between')
    expect(classifyHeadTurn(0.41)).toBe('between')
  })

  it('is unknown when landmarks are missing or degenerate', () => {
    expect(headTurnRatio(undefined)).toBeNull()
    expect(headTurnRatio(landmarks({ jawStart: 50, jawEnd: 50, nose: 50 }))).toBeNull()
    expect(classifyHeadTurn(null)).toBeNull()
  })
})

describe('poseVerdict', () => {
  it('passes any head angle for poses that cannot be verified', () => {
    expect(poseVerdict(null, 'left').ok).toBe(true)
  })

  it('accepts the matching direction', () => {
    expect(poseVerdict('left', 'left').ok).toBe(true)
    expect(poseVerdict('front', 'front').ok).toBe(true)
  })

  it('gives a direction-specific hint when it does not match', () => {
    expect(poseVerdict('left', 'right').hint).toBe('Turn to the left, not the right')
    expect(poseVerdict('right', 'front').hint).toBe('Turn a little more to the right')
    expect(poseVerdict('front', 'left').hint).toBe('Look straight at the camera')
    expect(poseVerdict('left', 'front').ok).toBe(false)
  })

  it('marks an unreadable angle as unknown, not as a hard failure of the person', () => {
    const v = poseVerdict('left', null)
    expect(v.ok).toBe(false)
    expect(v.unknown).toBe(true)
  })
})

describe('SAMPLE_POSES', () => {
  it('starts straight, then left, then right', () => {
    expect(SAMPLE_POSES.slice(0, 3).map((p) => p.needs)).toEqual(['front', 'left', 'right'])
  })
})

describe('enrollSamplesSequentially', () => {
  it('counts near-identical rejections as skipped, and stops on any other error', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { data: { error: 'sample_too_similar' } } })
      .mockRejectedValueOnce({ response: { data: { error: 'inconsistent_face' } } })
      .mockResolvedValue({})
    const result = await enrollSamplesSequentially([1, 2, 3, 4], send)
    expect(result.saved).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.error.response.data.error).toBe('inconsistent_face')
    expect(send).toHaveBeenCalledTimes(3) // the 4th is never sent
  })
})
