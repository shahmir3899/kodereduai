import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WARM_ROUTES, warmRouteChunk } from '../warmRouteChunk'

describe('warmRouteChunk', () => {
  const table = () => [
    { pattern: /^\/students\/?$/, load: vi.fn(() => Promise.resolve()) },
    { pattern: /^\/students\/[^/]+\/?$/, load: vi.fn(() => Promise.resolve()) },
  ]

  it('starts the matching route load and nothing else', async () => {
    const routes = table()
    expect(warmRouteChunk('/students/720', routes)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(routes[1].load).toHaveBeenCalledTimes(1)
    expect(routes[0].load).not.toHaveBeenCalled()
  })

  it('does nothing for routes outside the table (dashboard, login, unknown)', () => {
    const routes = table()
    for (const p of ['/dashboard', '/login', '/', '/nope', '', undefined]) {
      expect(warmRouteChunk(p, routes)).toBe(false)
    }
    expect(routes[0].load).not.toHaveBeenCalled()
  })

  it('swallows a failing download (the router will retry on render)', async () => {
    const routes = [{ pattern: /^\/x$/, load: () => Promise.reject(new Error('offline')) }]
    expect(warmRouteChunk('/x', routes)).toBe(true)
    await new Promise((r) => setTimeout(r, 0)) // would surface as an unhandled rejection if not caught
  })
})

describe('WARM_ROUTES table', () => {
  const app = readFileSync(resolve(__dirname, '../../App.jsx'), 'utf8')

  it.each(WARM_ROUTES.map((r) => [r.file]))('%s is the same module App.jsx lazy-loads', (file) => {
    expect(app).toContain(`lazy(() => import('./${file}'))`)
  })

  it('has no pattern that would swallow the dashboard or login', () => {
    for (const p of ['/dashboard', '/login', '/']) {
      expect(WARM_ROUTES.some((r) => r.pattern.test(p))).toBe(false)
    }
  })
})
