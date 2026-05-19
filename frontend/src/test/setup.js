import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll } from 'vitest'

let server
const skipMsw = process.env.SKIP_MSW === '1'

beforeAll(async () => {
  if (skipMsw) {
    return
  }

  const { TransformStream, ReadableStream, WritableStream } = await import('node:stream/web')

  if (!globalThis.TransformStream) {
    Object.defineProperty(globalThis, 'TransformStream', {
      value: TransformStream,
      configurable: true,
      writable: true,
    })
  }

  if (!globalThis.ReadableStream) {
    Object.defineProperty(globalThis, 'ReadableStream', {
      value: ReadableStream,
      configurable: true,
      writable: true,
    })
  }

  if (!globalThis.WritableStream) {
    Object.defineProperty(globalThis, 'WritableStream', {
      value: WritableStream,
      configurable: true,
      writable: true,
    })
  }

  if (typeof window !== 'undefined' && !window.TransformStream) {
    Object.defineProperty(window, 'TransformStream', {
      value: TransformStream,
      configurable: true,
      writable: true,
    })
  }

  if (typeof window !== 'undefined' && !window.ReadableStream) {
    Object.defineProperty(window, 'ReadableStream', {
      value: ReadableStream,
      configurable: true,
      writable: true,
    })
  }

  if (typeof window !== 'undefined' && !window.WritableStream) {
    Object.defineProperty(window, 'WritableStream', {
      value: WritableStream,
      configurable: true,
      writable: true,
    })
  }

  if (typeof self !== 'undefined' && !self.TransformStream) {
    Object.defineProperty(self, 'TransformStream', {
      value: TransformStream,
      configurable: true,
      writable: true,
    })
  }

  if (typeof self !== 'undefined' && !self.ReadableStream) {
    Object.defineProperty(self, 'ReadableStream', {
      value: ReadableStream,
      configurable: true,
      writable: true,
    })
  }

  if (typeof self !== 'undefined' && !self.WritableStream) {
    Object.defineProperty(self, 'WritableStream', {
      value: WritableStream,
      configurable: true,
      writable: true,
    })
  }

  const msw = await import('./mocks/server')
  server = msw.server
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterEach(() => {
  cleanup()
  if (!skipMsw) {
    server?.resetHandlers()
  }
})

afterAll(() => {
  if (!skipMsw) {
    server?.close()
  }
})
