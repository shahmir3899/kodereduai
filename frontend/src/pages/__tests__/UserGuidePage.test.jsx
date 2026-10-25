import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  value: {
    user: { id: 7 }, effectiveRole: 'SCHOOL_ADMIN', isSuperAdmin: false, isParent: false, isStudent: false,
    isStaffLevel: false, isManager: false, isModuleEnabled: () => true,
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))

import UserGuidePage from '../UserGuidePage'

function renderPage(url = '/guide') {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = vi.fn()
  return render(<MemoryRouter initialEntries={[url]}><UserGuidePage /></MemoryRouter>)
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return this._paused !== false }, configurable: true })
})

describe('UserGuidePage', () => {
  it('opens on a Start here path and quiet chapter rows, with nothing expanded', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /Start with these/ })).toBeInTheDocument()
    const steps = within(screen.getByRole('region', { name: /Start with these/ })).getAllByRole('listitem')
    expect(steps.length).toBe(8)
    expect(screen.getByRole('button', { name: /Getting Started/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('gives a step with a video no manual tick, so progress cannot be self-awarded', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /Mark step 1 as done/ })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('opens a video in the dialog from Start here and completes the step only after enough is played', () => {
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: /Watch/ })[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { value: 100, configurable: true })
    video._paused = false
    // play 0 -> 50 in half-second steps: 50% is not enough
    for (let t = 0.5; t <= 50; t += 0.5) { video.currentTime = t; fireEvent.timeUpdate(video) }
    fireEvent.pause(video)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    video._paused = false
    for (let t = 50.5; t <= 90; t += 0.5) { video.currentTime = t; fireEvent.timeUpdate(video) }
    fireEvent.pause(video)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('shows the grouped Videos tab with its own search', () => {
    renderPage('/guide?tab=videos')
    expect(screen.getByLabelText('Search videos')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Start here' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Daily attendance/ })).toBeInTheDocument()
  })

  it('deep links straight to one opened topic', () => {
    renderPage('/guide?chapter=3&section=1')
    expect(screen.getByRole('button', { name: /Marking Attendance/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
