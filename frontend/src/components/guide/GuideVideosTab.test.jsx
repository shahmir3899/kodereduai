import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import GuideVideosTab from './GuideVideosTab'

const v = (id, chapter, en, seconds = 60, extra = {}) => ({ id, chapter, title: { en, ur: `${en} (ur)` }, seconds: { en: seconds, ur: seconds }, summary: `About ${en}`, ...extra })
const videos = [
  v('a', 6, 'Grade scale'), v('b', 6, 'Exam types'), v('c', 6, 'Create exam'), v('d', 6, 'Enter marks'), v('e', 6, 'Results'), v('f', 6, 'Report cards'),
  v('g', 7, 'Fee setup'), v('h', 3, 'Mark attendance'),
]

function setup(props = {}) {
  const onSelect = vi.fn()
  const onLang = vi.fn()
  render(<GuideVideosTab videos={videos} startVideos={[videos[7], videos[6]]} lang="en" onLang={onLang} onSelect={onSelect} watched={new Set()} {...props} />)
  return { onSelect, onLang }
}

describe('GuideVideosTab', () => {
  it('shows the Start here row first, numbered, then groups by job', () => {
    setup({ startVideos: [videos[7], videos[6]] })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings[0]).toBe('Start here')
    expect(headings).toEqual(expect.arrayContaining([expect.stringContaining('Exams and results')]))
    const start = screen.getByRole('region', { name: 'Start here' })
    expect(within(start).getByText('1')).toBeInTheDocument()
    expect(within(start).getByText('2')).toBeInTheDocument()
  })

  it('does not repeat a Start here video inside its group', () => {
    setup()
    // attendance and fees each hold only a Start here video, so those groups are not shown a second time
    expect(screen.queryByRole('region', { name: /Daily attendance/ })).toBeNull()
    expect(screen.queryByRole('region', { name: /Fees and money/ })).toBeNull()
    expect(screen.getAllByText('Mark attendance')).toHaveLength(1)
  })

  it('shows four cards per group and the rest on "Show all"', () => {
    setup()
    const exams = screen.getByRole('region', { name: /Exams and results/ })
    expect(within(exams).getAllByRole('button').filter((b) => b.querySelector('img')).length).toBe(4)
    fireEvent.click(within(exams).getByRole('button', { name: 'Show all 6' }))
    expect(within(exams).getAllByRole('button').filter((b) => b.querySelector('img')).length).toBe(6)
    expect(within(exams).getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
  })

  it('searches titles and drops the groups while searching', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Search videos'), { target: { value: 'fee' } })
    expect(screen.getByText(/1 result for/)).toBeInTheDocument()
    expect(screen.getByText('Fee setup')).toBeInTheDocument()
    expect(screen.queryByText('Grade scale')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search videos'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No video matches/)).toBeInTheDocument()
  })

  it('marks watched videos and counts them in the group heading', () => {
    setup({ watched: new Set(['a', 'b']) })
    expect(screen.getAllByText(/Watched/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('region', { name: /Exams and results/ })).toHaveTextContent('2 watched')
  })

  it('switches the card titles to Urdu and reports the language change', () => {
    const { onLang } = setup({ lang: 'ur' })
    expect(screen.getAllByText('Mark attendance (ur)').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(onLang).toHaveBeenCalledWith('en')
  })

  it('opens a video when its card is clicked', () => {
    const { onSelect } = setup()
    const exams = screen.getByRole('region', { name: /Exams and results/ })
    fireEvent.click(within(exams).getByText('Grade scale'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
