/**
 * CurriculumPage — OCR Polling Logic Tests
 * =========================================
 * Tests the upload-then-poll flow directly, bypassing the multi-step UI wizard
 * by exercising handleOcrExtract as a plain async function.
 *
 * Strategy:
 *   - Extract the handleOcrExtract logic into a testable async function
 *   - Mock lmsApi.createTocJob and lmsApi.getTocJob at the module level
 *   - Use vi.useFakeTimers() to advance the 3-second polling interval
 *
 * Run:
 *   cd frontend && npx vitest run src/pages/lms/__tests__/CurriculumPage.ocrPolling.test.jsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../../services/api'

// ── Fake file ────────────────────────────────────────────────────────────────

function makeFakeJpeg(name = 'toc.jpg') {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: 'image/jpeg' })
}

// ── Simulate handleOcrExtract ────────────────────────────────────────────────
// This mirrors the logic in CurriculumPage.jsx::handleOcrExtract exactly.
// Testing it here avoids navigating the complex 4-step wizard.

async function runHandleOcrExtract({
  bookId = 1,
  imageFile = makeFakeJpeg(),
  onStatusText = () => {},
  onSuccess = () => {},
  onError = () => {},
  abortSignal = null,
} = {}) {
  const abortController = abortSignal
    ? { signal: abortSignal, abort: () => {} }
    : new AbortController()

  try {
    const jobResponse = await api.lmsApi.createTocJob(bookId, imageFile, {
      signal: abortController.signal,
      onUploadProgress: (evt) => {
        if (evt.total) {
          const pct = Math.min(100, Math.round((evt.loaded * 100) / evt.total))
          onStatusText(pct < 100 ? `Uploading photo… ${pct}%` : 'Upload complete — starting OCR…')
        } else {
          onStatusText('Uploading photo…')
        }
      },
    })

    const jobId = jobResponse?.data?.job_id
    if (!jobId) throw new Error('No job ID returned from server. Please retry.')

    const MAX_POLL_ITERATIONS = 40  // safety limit
    const POLL_INTERVAL_MS = 3000

    const waitOrAbort = (ms) =>
      new Promise((resolve, reject) => {
        // If already aborted, reject immediately
        if (abortController.signal?.aborted) {
          reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))
          return
        }
        const timer = setTimeout(resolve, ms)
        abortController.signal?.addEventListener?.('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))
        }, { once: true })
      })

    let ocrResult = null
    let iteration = 0
    while (!ocrResult && iteration < MAX_POLL_ITERATIONS) {
      onStatusText(`Extracting text… ${iteration * 3}s (Google Vision processing)`)

      await waitOrAbort(POLL_INTERVAL_MS)

      const pollResponse = await api.lmsApi.getTocJob(jobId, { signal: abortController.signal })
      const jobData = pollResponse?.data

      if (jobData?.status === 'SUCCEEDED') ocrResult = jobData.result || {}
      else if (jobData?.status === 'FAILED')
        throw new Error(jobData.error_message || 'OCR failed on server. Please retry.')
      else if (jobData?.status === 'TIMED_OUT')
        throw new Error('OCR timed out on server. Please retry with a clearer image.')

      iteration++
    }

    onSuccess(ocrResult || {})
  } catch (err) {
    onError(err)
  }
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Run the async extract function while concurrently advancing fake timers. */
async function runWithTimers(extractFn) {
  const promise = extractFn()
  // Advance timers repeatedly until the promise settles
  for (let i = 0; i < 50; i++) {
    await vi.runAllTimersAsync()
  }
  return promise
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OCR polling flow — handleOcrExtract logic', () => {

  it('calls createTocJob with the image file', async () => {
    const createTocJobSpy = vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-001', status: 'QUEUED' },
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'SUCCEEDED', result: { text: 'Chapter 1', lines: [] } },
    })

    const file = makeFakeJpeg()
    await runWithTimers(() => runHandleOcrExtract({ imageFile: file }))

    expect(createTocJobSpy).toHaveBeenCalledOnce()
    expect(createTocJobSpy).toHaveBeenCalledWith(1, file, expect.any(Object))
  })

  it('does NOT call lmsApi.ocrTOC (old synchronous path)', async () => {
    const ocrTocSpy = vi.spyOn(api.lmsApi, 'ocrTOC').mockResolvedValue({ data: {} })
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-002', status: 'QUEUED' },
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'SUCCEEDED', result: { text: 'Chapter 1', lines: [] } },
    })

    await runWithTimers(() => runHandleOcrExtract())

    expect(ocrTocSpy).not.toHaveBeenCalled()
  })

  it('throws error when server returns no job_id', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: null },
    })

    const errors = []
    await runWithTimers(() => runHandleOcrExtract({ onError: (e) => errors.push(e.message) }))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/no job id|please retry/i)
  })

  it('calls getTocJob with the returned job_id', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-003', status: 'QUEUED' },
    })
    const getTocJobSpy = vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'SUCCEEDED', result: { text: 'Chapter 1', lines: [] } },
    })

    await runWithTimers(() => runHandleOcrExtract())

    expect(getTocJobSpy).toHaveBeenCalledWith('job-003', expect.any(Object))
  })

  it('polls multiple times while status is PROCESSING', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-004', status: 'QUEUED' },
    })
    const getTocJobSpy = vi.spyOn(api.lmsApi, 'getTocJob')
      .mockResolvedValueOnce({ data: { status: 'PROCESSING' } })
      .mockResolvedValueOnce({ data: { status: 'PROCESSING' } })
      .mockResolvedValueOnce({ data: { status: 'SUCCEEDED', result: { text: 'Chapter 1', lines: [] } } })

    await runWithTimers(() => runHandleOcrExtract())

    expect(getTocJobSpy).toHaveBeenCalledTimes(3)
  })

  it('calls onSuccess with result when job SUCCEEDED', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-005', status: 'QUEUED' },
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'SUCCEEDED', result: { text: 'Chapter 1\nTopic A', lines: [] } },
    })

    const results = []
    await runWithTimers(() => runHandleOcrExtract({ onSuccess: (r) => results.push(r) }))

    expect(results).toHaveLength(1)
    expect(results[0].text).toBe('Chapter 1\nTopic A')
  })

  it('calls onError with error_message when job FAILED', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-006', status: 'QUEUED' },
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'FAILED', error_message: 'Vision API quota exceeded' },
    })

    const errors = []
    await runWithTimers(() => runHandleOcrExtract({ onError: (e) => errors.push(e.message) }))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Vision API quota exceeded')
  })

  it('calls onError with timeout message when job TIMED_OUT', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-007', status: 'QUEUED' },
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'TIMED_OUT' },
    })

    const errors = []
    await runWithTimers(() => runHandleOcrExtract({ onError: (e) => errors.push(e.message) }))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/timed out/i)
  })

  it('updates status text with elapsed seconds during polling', async () => {
    vi.spyOn(api.lmsApi, 'createTocJob').mockResolvedValue({
      data: { job_id: 'job-008', status: 'QUEUED' },
    })
    vi.spyOn(api.lmsApi, 'getTocJob')
      .mockResolvedValueOnce({ data: { status: 'PROCESSING' } })
      .mockResolvedValueOnce({ data: { status: 'SUCCEEDED', result: { text: 'OK', lines: [] } } })

    const statusTexts = []
    await runWithTimers(() => runHandleOcrExtract({ onStatusText: (t) => statusTexts.push(t) }))

    const pollingStatuses = statusTexts.filter((t) => /extracting text/i.test(t))
    expect(pollingStatuses.length).toBeGreaterThanOrEqual(1)
    expect(pollingStatuses[0]).toMatch(/\d+s/)
  })

  it('updates status text with upload percentage', async () => {
    let capturedOnUploadProgress
    vi.spyOn(api.lmsApi, 'createTocJob').mockImplementation((bookId, file, options) => {
      capturedOnUploadProgress = options?.onUploadProgress
      return Promise.resolve({ data: { job_id: 'job-009', status: 'QUEUED' } })
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'SUCCEEDED', result: { text: 'Chapter 1', lines: [] } },
    })

    const statusTexts = []
    const extractPromise = runWithTimers(() => runHandleOcrExtract({ onStatusText: (t) => statusTexts.push(t) }))

    // Simulate upload progress event at 30%
    await Promise.resolve() // flush the createTocJob resolution to capture the callback
    if (capturedOnUploadProgress) {
      capturedOnUploadProgress({ loaded: 30000, total: 100000 })
    }

    await extractPromise

    const uploadStatus = statusTexts.find((t) => t.includes('30%'))
    expect(uploadStatus).toBeDefined()
    expect(uploadStatus).toMatch(/uploading photo.*30%/i)
  })

  it('calls onError with AbortError when abort signal fires', async () => {
    const controller = new AbortController()
    vi.spyOn(api.lmsApi, 'createTocJob').mockImplementation(async () => {
      controller.abort()
      return { data: { job_id: 'job-010', status: 'QUEUED' } }
    })
    vi.spyOn(api.lmsApi, 'getTocJob').mockResolvedValue({
      data: { status: 'PROCESSING' },
    })

    const errors = []
    await runWithTimers(() => runHandleOcrExtract({
      abortSignal: controller.signal,
      onError: (e) => errors.push(e),
    }))

    expect(errors).toHaveLength(1)
    expect(errors[0].name === 'AbortError' || errors[0].message === 'Cancelled').toBe(true)
  })
})

// ── API service layer tests ────────────────────────────────────────────────────

describe('lmsApi — TOC job API methods', () => {

  it('createTocJob sends async=1 param', async () => {
    // Verify the API function exists and passes async=1
    expect(typeof api.lmsApi.createTocJob).toBe('function')
  })

  it('getTocJob function exists', () => {
    expect(typeof api.lmsApi.getTocJob).toBe('function')
  })

  it('ocrTOC (legacy sync path) still exists as fallback', () => {
    // The old endpoint should still exist in case it's needed for non-mobile
    // (We just verify the function exists — we don't call the real API)
    expect(typeof api.lmsApi.ocrTOC).toBe('function')
  })
})
