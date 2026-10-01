import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const getMyNotifications = vi.fn()
const getDigest = vi.fn()
const markReadBulk = vi.fn().mockResolvedValue({})
const getUnreadCount = vi.fn()

vi.mock('../../../services/api', () => ({
  notificationsApi: {
    getMyNotifications: (...a) => getMyNotifications(...a),
    getDigest: (...a) => getDigest(...a),
    markRead: vi.fn().mockResolvedValue({}),
    markReadBulk: (...a) => markReadBulk(...a),
    getUnreadCount: (...a) => getUnreadCount(...a),
  },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'SCHOOL_ADMIN', schools: [{ id: 1 }, { id: 2 }] },
    activeSchool: { id: 1 },
  }),
}))

import NotificationCarousel from '../NotificationCarousel'

const mk = (id, over = {}) => ({
  id,
  event_type: 'ABSENCE',
  school: 1,
  school_name: 'Branch 1',
  student: id,
  student_name: `Student ${id}`,
  title: `Absent ${id}`,
  body: 'body',
  is_read: false,
  created_at: new Date().toISOString(),
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  getUnreadCount.mockReset()
  getUnreadCount.mockRejectedValue(new Error('no server count'))
})

// jsdom lacks AnimationEvent, so React may listen for the prefixed name; fire both.
const endAnimation = (el) => {
  fireEvent(el, new Event('animationend', { bubbles: true }))
  fireEvent(el, new Event('webkitAnimationEnd', { bubbles: true }))
}

const setMode = (m) => localStorage.setItem('notificationCarouselMode', m)

function renderCarousel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationCarousel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('NotificationCarousel', () => {
  beforeEach(() => {
    getMyNotifications.mockReset()
    getDigest.mockReset()
  })

  it('shows digest first, bundles repeats, and ends with a see-all slide', async () => {
    getMyNotifications.mockResolvedValue({
      data: {
        count: 5,
        next: null,
        results: [mk(1), mk(2), mk(3), mk(4, { event_type: 'GENERAL', title: 'Staff meeting' })],
      },
    })
    getDigest.mockResolvedValue({
      data: { text: 'You have 4 unread notifications.', source: 'rules', total: 4, stats: [{ event_type: 'ABSENCE', count: 3, label: 'absence alerts' }] },
    })

    renderCarousel()

    await screen.findByText('You have 4 unread notifications.')
    // digest + 1 bundle + 1 single + end slide
    expect(screen.getAllByRole('group', { hidden: true }).filter((g) => g.getAttribute('aria-roledescription') === 'slide')).toHaveLength(4)
    expect(screen.getByText('3 absence alerts')).toBeTruthy()
    expect(screen.getByText('Staff meeting')).toBeTruthy()
    expect(screen.getByText('See all notifications')).toBeTruthy()
    // two schools -> school name is shown on cards
    expect(screen.getAllByText('Branch 1').length).toBeGreaterThan(0)
  })

  it('omits the digest slide when nothing is unread and moves with next', async () => {
    getMyNotifications.mockResolvedValue({
      data: { count: 1, next: null, results: [mk(1, { is_read: true })] },
    })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })
    setMode('all')

    renderCarousel()

    await screen.findByText('Absent 1')
    expect(screen.queryByText(/Daily digest/)).toBeNull()
    expect(screen.getByText('All read')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Next slide'))
    await waitFor(() => {
      expect(screen.getByLabelText('Go to slide 2').getAttribute('aria-current')).toBe('true')
    })
  })

  it('shows the empty state with no notifications', async () => {
    getMyNotifications.mockResolvedValue({ data: { count: 0, next: null, results: [] } })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })
    setMode('all')

    renderCarousel()

    await screen.findByText('No notifications')
  })
})

describe('NotificationCarousel read tracking', () => {
  beforeEach(() => {
    getMyNotifications.mockReset()
    getDigest.mockReset()
    markReadBulk.mockClear()
    vi.useRealTimers()
  })

  it('marks a slide read after it has been shown and lowers the unread count', async () => {
    getMyNotifications.mockResolvedValue({
      data: { count: 2, next: null, results: [mk(1, { event_type: 'GENERAL' }), mk(2, { event_type: 'FEE_DUE' })] },
    })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })

    renderCarousel()
    await screen.findByText('2 unread')

    // First slide is on screen; after the dwell it is marked read.
    await waitFor(() => expect(screen.getByText('1 unread')).toBeTruthy(), { timeout: 3000 })
    expect(markReadBulk).toHaveBeenCalledTimes(1)
    expect(markReadBulk.mock.calls[0][0]).toHaveLength(1)
  })

  it('marks a small bundle read once all its members have been on screen', async () => {
    getMyNotifications.mockResolvedValue({
      data: { count: 3, next: null, results: [mk(1), mk(2), mk(3)] },
    })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })

    renderCarousel()
    await screen.findByText('3 unread')

    await waitFor(() => expect(screen.getByText('All read')).toBeTruthy(), { timeout: 3000 })
    expect(markReadBulk).toHaveBeenCalledWith(expect.arrayContaining([1, 2, 3]))
  })
})

describe('NotificationCarousel content', () => {
  beforeEach(() => {
    getMyNotifications.mockReset()
    getDigest.mockReset()
  })

  it('shows fee amounts, absent names and a fee total without opening anything', async () => {
    getMyNotifications.mockResolvedValue({
      data: {
        count: 4,
        next: null,
        results: [
          mk(1, { event_type: 'FEE_DUE', student_name: null, title: 'Fee Pending — Class 5', body: 'An amount of Rs 40,800 is pending for Class 5.' }),
          mk(2, { event_type: 'FEE_DUE', student_name: null, title: 'Fee Pending — Class 4', body: 'An amount of Rs 46,300 is pending for Class 4.' }),
          mk(3, { event_type: 'FEE_DUE', student_name: null, title: 'Fee Pending — Class 3', body: 'An amount of Rs 1,000 is pending for Class 3.' }),
          mk(4, { event_type: 'ABSENCE', student_name: null, school: 2, title: 'Junior 2 — 2 absent - 01 October 2026', body: 'Syed M Rayan, Syeda Maanha Zahra' }),
        ],
      },
    })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })

    renderCarousel()

    await screen.findByText('An amount of Rs 40,800 is pending for Class 5.')
    expect(screen.getByText('An amount of Rs 46,300 is pending for Class 4.')).toBeTruthy()
    expect(screen.getByText(/Rs 88,100/)).toBeTruthy()
    expect(screen.getByText('Junior 2 — 2 absent - 01 October 2026')).toBeTruthy()
    expect(screen.getByText('Syed M Rayan, Syeda Maanha Zahra')).toBeTruthy()
  })

  it('folds a very long absent list but can reveal all of it', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `Student Number ${i + 1}`).join(', ')
    getMyNotifications.mockResolvedValue({
      data: { count: 1, next: null, results: [mk(1, { student_name: null, title: 'Class 6 — 30 absent', body: names })] },
    })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })

    renderCarousel()

    await screen.findByText('Show more')
    fireEvent.click(screen.getByText('Show more'))
    expect(screen.getByText('Show less')).toBeTruthy()
    expect(screen.getByText(names)).toBeTruthy()
  })
})

describe('NotificationCarousel unread figure', () => {
  beforeEach(() => {
    getMyNotifications.mockReset()
    getDigest.mockReset()
  })

  it('shows the server unread count, not a count of the pages it has loaded', async () => {
    // 3 unread rows are loaded, but the server (same figure as the bell) says 17.
    getMyNotifications.mockResolvedValue({
      data: { count: 40, next: null, results: [mk(1), mk(2), mk(3)] },
    })
    getUnreadCount.mockResolvedValue({ data: { unread_count: 17 } })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })

    renderCarousel()

    await screen.findByText('17 unread')
  })

  it('does not double count a row that appears on two pages', async () => {
    getMyNotifications
      .mockResolvedValueOnce({ data: { count: 3, next: 'p2', results: [mk(1), mk(2)] } })
      .mockResolvedValue({ data: { count: 3, next: null, results: [mk(2), mk(3)] } })
    getDigest.mockResolvedValue({ data: { text: '', stats: [], total: 0, source: 'none' } })

    renderCarousel()

    // Local fallback count (no server figure): 3 distinct rows, not 4.
    await waitFor(() => expect(getMyNotifications).toHaveBeenCalledTimes(2))
    await screen.findByText('3 unread')
  })
})

describe('NotificationCarousel unread priority', () => {
  const noDigest = { data: { text: '', stats: [], total: 0, source: 'none' } }

  beforeEach(() => {
    getMyNotifications.mockReset()
    getDigest.mockReset()
    getDigest.mockResolvedValue(noDigest)
  })

  it('opens on Unread and asks the server for unread only', async () => {
    getMyNotifications.mockResolvedValue({ data: { count: 1, next: null, results: [mk(1)] } })

    renderCarousel()

    await screen.findByText('Absent 1')
    expect(getMyNotifications).toHaveBeenCalledWith(expect.objectContaining({ unread: 1 }))
    expect(screen.getByText('Unread', { selector: 'button' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches to All, requests everything and remembers the choice', async () => {
    getMyNotifications.mockImplementation(({ unread }) =>
      Promise.resolve({
        data: {
          count: unread ? 1 : 2,
          next: null,
          results: unread ? [mk(1)] : [mk(1), mk(2, { event_type: 'GENERAL', title: 'Old news', is_read: true })],
        },
      }),
    )

    renderCarousel()
    await screen.findByText('Absent 1')
    expect(screen.queryByText('Old news')).toBeNull()

    fireEvent.click(screen.getByText('All', { selector: 'button' }))

    await screen.findByText('Old news')
    expect(localStorage.getItem('notificationCarouselMode')).toBe('all')
  })

  it('marks unread dots and puts a slide that was read behind the unread ones after leaving it', async () => {
    setMode('all')
    getMyNotifications.mockResolvedValue({
      data: { count: 2, next: null, results: [mk(1, { event_type: 'GENERAL', title: 'First' }), mk(2, { event_type: 'GENERAL', title: 'Second' })] },
    })

    renderCarousel()
    await screen.findByText('2 unread')

    // Slide 1 gets read after the dwell but stays in place while it is on screen.
    await waitFor(() => expect(screen.getByText('1 unread')).toBeTruthy(), { timeout: 3000 })
    expect(screen.getByLabelText('Go to slide 1').getAttribute('aria-current')).toBe('true')
    expect(screen.getByLabelText('Go to slide 2 (unread)')).toBeTruthy()

    // Leaving it sends it behind the remaining unread slide.
    fireEvent.click(screen.getByLabelText('Next slide'))
    await waitFor(() => expect(screen.getByLabelText('Go to slide 1 (unread)').getAttribute('aria-current')).toBe('true'))
    expect(screen.getByLabelText('Go to slide 2').getAttribute('aria-current')).toBe('false')
    expect(screen.queryByLabelText('Go to slide 2 (unread)')).toBeNull()
  })

  it('autoplay plays each unread slide once, then rests', async () => {
    setMode('all')
    getMyNotifications.mockResolvedValue({
      data: {
        count: 3,
        next: null,
        results: [
          mk(1, { event_type: 'GENERAL', title: 'U1' }),
          mk(2, { event_type: 'FEE_DUE', title: 'U2' }),
          mk(3, { event_type: 'EXAM_RESULT', title: 'R1', is_read: true }),
        ],
      },
    })

    // The shared matchMedia polyfill answers "yes" to every query, which would
    // read as prefers-reduced-motion and switch autoplay off.
    const original = window.matchMedia
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

    const { container } = renderCarousel()
    await screen.findByText('U1')

    endAnimation(container.querySelector('.notif-progress'))
    await waitFor(() => expect(screen.getByLabelText(/Go to slide 2/).getAttribute('aria-current')).toBe('true'))

    // Nothing unread left to play: it stays on the last unread slide and stops animating.
    endAnimation(container.querySelector('.notif-progress'))
    await waitFor(() => expect(container.querySelector('.notif-progress')).toBeNull())
    expect(screen.getByLabelText(/Go to slide 2/).getAttribute('aria-current')).toBe('true')
    window.matchMedia = original
  })
})
