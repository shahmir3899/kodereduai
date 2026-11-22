import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BlockScanReview from '../BlockScanReview'

vi.mock('../../../../services/api', () => ({
  questionPaperApi: {
    getBlockTypes: () => Promise.resolve({ data: { blocks: [
      { type: 'count_write', kind: 'activity', label: 'Count and write', fields: [] },
      { type: 'writing_grid', kind: 'activity', label: 'Writing grid', fields: [] },
      { type: 'section_heading', kind: 'layout', label: 'Section heading', fields: [] },
    ] } }),
  },
}))
vi.mock('../PicturePicker', () => ({
  describePicture: (ref) => (typeof ref === 'string' && ref !== 'robot'
    ? { label: ref, image: `/lib/${ref}.png` }
    : ref?.url ? { label: 'Picture from the old paper', image: ref.url } : { label: String(ref), image: null }),
  usePictureLookups: () => ({ catalog: [], uploads: [], makers: [] }),
}))
vi.mock('../../PaperPageViewer', () => ({ default: ({ activePage }) => <div>photo page {activePage}</div> }))

const result = {
  scan_mode: 'blocks',
  header: { total_marks: 15 },
  notes: ['Question 3 (Draw) was left out: unknown kind of question.'],
  pictures: { library: 1, cropped: 1, missing: 1 },
  blocks: [
    { id: 'h', type: 'section_heading', title: 'Section A', page_number: 1 },
    { id: 'a', type: 'count_write', title: 'Count and write?', marks: 5, page_number: 1,
      data: { rows: [{ picture: 'apple', count: 3 }, { picture: { url: 'https://files/c.jpg' }, count: 2 }, { picture: 'robot', count: 1 }] } },
    { id: 'b', type: 'writing_grid', title: 'Write 1 to 20', marks: 10, page_number: 2, data: { rows: 4, cols: 5 } },
  ],
}
const pages = [{ page_number: 1, image_url: 'https://files/p1.jpg' }, { page_number: 2, image_url: 'https://files/p2.jpg' }]

function renderReview(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BlockScanReview result={result} pages={pages} onAccept={vi.fn()} onStartOver={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

describe('BlockScanReview', () => {
  it('shows each block with its kind, pictures, notes and the marks check', async () => {
    renderReview()
    expect(await screen.findByText(/Q1 · Count and write/)).toBeInTheDocument()
    expect(screen.getByText(/Q2 · Writing grid · page 2/)).toBeInTheDocument()
    expect(screen.getByText('Section A')).toBeInTheDocument()
    expect(screen.getByText(/1 from the library, 1 cut from the photo/)).toBeInTheDocument()
    expect(screen.getByText(/left out: unknown kind/)).toBeInTheDocument()
    expect(screen.getByAltText('apple')).toHaveAttribute('src', '/lib/apple.png')
    expect(screen.getByTitle(/Not found/)).toHaveTextContent('robot')
    expect(screen.getByText(/15 \/ 15 marks/)).toBeInTheDocument()
  })

  it('adds only the ticked blocks', async () => {
    const onAccept = vi.fn()
    renderReview({ onAccept })
    fireEvent.click(await screen.findByLabelText('Add question 2 to the paper'))
    expect(screen.getByText(/add up to 5 marks; the paper says 15/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to the paper' }))
    expect(onAccept.mock.calls[0][0].map((b) => b.id)).toEqual(['h', 'a'])
  })

  it('moves the photo to the page of a clicked block, and starts over', async () => {
    const onStartOver = vi.fn()
    renderReview({ onStartOver })
    fireEvent.click(await screen.findByText('Write 1 to 20'))
    expect(screen.getByText('photo page 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(onStartOver).toHaveBeenCalled()
  })

  it('cannot add nothing', async () => {
    renderReview({ result: { ...result, blocks: [result.blocks[2]], header: {} } })
    fireEvent.click(await screen.findByLabelText('Add question 1 to the paper'))
    expect(screen.getByRole('button', { name: 'Add 0 to the paper' })).toBeDisabled()
  })
})
