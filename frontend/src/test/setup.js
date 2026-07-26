import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll } from 'vitest'

// jsdom doesn't implement matchMedia — polyfill it so components using
// useMediaQuery (and other matchMedia-based responsive logic) render in tests.
// Evaluates min-width/max-width against jsdom's window.innerWidth (default
// 1024px) so tests exercise the desktop layout unless a test explicitly
// shrinks the viewport, matching how existing tests assume desktop markup.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => {
    const minWidth = query.match(/min-width:\s*(\d+)px/)?.[1]
    const maxWidth = query.match(/max-width:\s*(\d+)px/)?.[1]
    const matches =
      (!minWidth || window.innerWidth >= Number(minWidth)) &&
      (!maxWidth || window.innerWidth <= Number(maxWidth))
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  }
}

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
