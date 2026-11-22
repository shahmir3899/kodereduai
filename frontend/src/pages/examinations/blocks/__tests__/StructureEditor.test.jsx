import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({ getExamPapers: vi.fn(), getPaperDocument: vi.fn() }))
vi.mock('../../../../services/api', () => ({ questionPaperApi: api, worksheetApi: {} }))
vi.mock('../../../../components/RichTextEditor', () => ({ default: () => null }))
vi.mock('../PicturePicker', () => ({ default: () => null, describePicture: () => null, usePictureLookups: () => ({ catalog: [] }) }))

import StructureEditor from '../StructureEditor'

const registry = {
  blocks: [
    { type: 'count_write', kind: 'activity', label: 'Count and write', fields: [{ name: 'rows', label: 'Rows', kind: 'list', max: 12, fields: [
      { name: 'picture', label: 'Picture', kind: 'picture' }, { name: 'count', label: 'How many', kind: 'int', min: 1, max: 7, default: 3 }] }] },
    { type: 'compare_objects', kind: 'activity', label: 'Compare objects', fields: [
      { name: 'mode', label: 'Compare', kind: 'choice', choices: ['size', 'length'], default: 'size', labels: { size: 'Big and small', length: 'Long and short' } }] },
    { type: 'oral', kind: 'activity', label: 'Oral', fields: [{ name: 'items', label: 'Questions', kind: 'list', fields: [{ name: 'text', label: 'Question', kind: 'text' }] }] },
  ],
  structure_templates: [{ id: 'pg', label: 'Play Group: Mathematics', rows: [
    { type: 'count_write', marks: 5, parts: 5 }, { type: 'compare_objects', marks: 4, data: { mode: 'length' } }, { type: 'oral', marks: 8, parts: 3 },
  ] }],
}

function renderStructure(props) {
  api.getExamPapers.mockResolvedValue({ data: { results: [] } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StructureEditor blocks={[]} registry={registry} paperId={1} classId={2} subjectId={3} onApply={vi.fn()} onSkip={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

describe('StructureEditor', () => {
  it('starts from a template and makes every question at once', () => {
    const onApply = vi.fn()
    renderStructure({ onApply })
    fireEvent.click(screen.getByRole('button', { name: 'Play Group: Mathematics' }))
    expect(screen.getByRole('status').textContent).toBe('17 of 17')
    fireEvent.change(screen.getByLabelText('Total marks'), { target: { value: '20' } })
    expect(screen.getByRole('status').textContent).toBe('17 of 20, 3 left')

    fireEvent.click(screen.getByRole('button', { name: '+ Add questions' }))
    const used = screen.getByRole('region', { name: 'Used in this paper' })
    fireEvent.click(used.querySelector('button'))           // Count and write, already in the paper
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 row' }))
    expect(screen.getByLabelText('Question 4 marks').value).toBe('5')   // same as the last Count and write
    expect(screen.getByRole('status').textContent).toBe('22 of 20, 2 over')

    fireEvent.click(screen.getByRole('button', { name: 'Make the questions' }))
    const blocks = onApply.mock.lastCall[0]
    expect(blocks.map((b) => [b.type, b.marks])).toEqual([['count_write', 5], ['compare_objects', 4], ['oral', 8], ['count_write', 5]])
    expect(blocks[0].data.rows).toHaveLength(5)
    expect(blocks[1].data.mode).toBe('length')
  })

  it('asks before removing a question that was already written', () => {
    const onApply = vi.fn()
    const written = { id: 'c', type: 'count_write', marks: 5, data: { rows: [{ picture: 'cat', count: 2 }] } }
    renderStructure({ onApply, blocks: [written] })
    expect(screen.getByText('in the paper')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make the questions' }))
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onApply).toHaveBeenCalledWith([])
  })

  it('Skip leaves the paper as it is', () => {
    const onSkip = vi.fn()
    renderStructure({ onSkip })
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('TypePicker in Structure', () => {
  it('adds several rows at once, early-years groups first for Play Group', () => {
    renderStructure({ className: 'Play Group' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add questions' }))
    const sections = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(sections[0]).toBe('Activities')
    fireEvent.click(screen.getByRole('button', { name: /^Oral/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Oral/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Count and write/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 rows' }))
    expect(screen.getByLabelText('Question 3 marks')).toBeTruthy()
  })
})
