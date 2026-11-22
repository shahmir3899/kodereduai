import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import BlockForm, { PaperDirectionContext, splitListText } from '../BlockForm'
import { openLanguage } from '../../../../components/richEditorCore'

vi.mock('../../../../components/RichTextEditor', () => ({
  default: ({ value, onChange, placeholder, defaultLanguage }) => (
    <textarea aria-label={placeholder} data-language={defaultLanguage} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('../PicturePicker', () => ({
  default: ({ open, onPick }) => (open ? <button type="button" onClick={() => onPick('apple')}>pick apple</button> : null),
  describePicture: (ref) => (ref ? { label: typeof ref === 'string' ? ref : 'picture', image: null } : null),
  usePictureLookups: () => ({
    catalog: [{ name: 'butterfly', en: 'Butterfly' }, { name: 'flower', en: 'Flower' }, { name: 'flower_pot', en: 'Flower pot' }],
    uploads: [],
    makers: [],
  }),
}))

const registry = {
  blocks: [
    {
      type: 'mcq', kind: 'text', label: 'Multiple choice', fields: [
        { name: 'items', label: 'Questions', kind: 'list', fields: [
          { name: 'text', label: 'Question', kind: 'richtext' },
          { name: 'options', label: 'Options', kind: 'list', min: 2, max: 6, fields: [
            { name: 'text', label: 'Option', kind: 'richtext', optional: true },
          ] },
          { name: 'answer', label: 'Correct option', kind: 'choice', choices: ['A', 'B', 'C', 'D'], optional: true },
        ] },
        { name: 'attempt', label: 'Attempt any', kind: 'int', min: 1, max: 60, optional: true },
      ],
    },
    {
      type: 'missing_sequence', kind: 'activity', label: 'Missing numbers', fields: [
        { name: 'items', label: 'Sequence', kind: 'text_list', max: 60, counting: true },
        { name: 'shape', label: 'Shape', kind: 'choice', choices: ['cloud', 'train', 'box'], default: 'cloud', optional: true },
      ],
    },
    { type: 'colour_picture', kind: 'activity', label: 'Colour the picture', fields: [{ name: 'picture', label: 'Picture', kind: 'picture' }] },
    { type: 'count_write', kind: 'activity', label: 'Count and write', fields: [{ name: 'rows', label: 'Rows', kind: 'list', max: 12, fields: [
      { name: 'picture', label: 'Picture', kind: 'picture' },
      { name: 'count', label: 'How many', kind: 'int', min: 1, max: 7, default: 3 },
    ] }] },
    { type: 'section_heading', kind: 'layout', label: 'Section heading', fields: [] },
  ],
}

function Harness({ initial, onChangeSpy }) {
  const [block, setBlock] = useState(initial)
  return <BlockForm block={block} registry={registry} onChange={(next) => { setBlock(next); onChangeSpy?.(next) }} />
}

describe('BlockForm', () => {
  it('builds the form from the field list and edits nested parts', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{
      id: 'b', type: 'mcq', title: 'Choose', marks: 4,
      data: { items: [{ key: 'k1', text: 'Q one', options: [{ key: 'o1', text: 'x' }, { key: 'o2', text: 'y' }] }] },
    }} />)

    fireEvent.change(screen.getByLabelText('Question heading'), { target: { value: 'Choose the correct option.' } })
    expect(spy.mock.lastCall[0].title).toBe('Choose the correct option.')

    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '6' } })
    expect(spy.mock.lastCall[0].marks).toBe(6)

    fireEvent.change(screen.getByDisplayValue('Q one'), { target: { value: 'Q changed' } })
    expect(spy.mock.lastCall[0].data.items[0].text).toBe('Q changed')

    fireEvent.click(screen.getByText('+ Add option'))
    expect(spy.mock.lastCall[0].data.items[0].options).toHaveLength(3)

    fireEvent.click(screen.getByText('+ Add part'))
    const items = spy.mock.lastCall[0].data.items
    expect(items).toHaveLength(2)
    expect(items[1].options).toHaveLength(4)        // a new MCQ part starts with four options
    expect(items[0].key).toBe('k1')                 // existing parts keep their keys (and bank links)
  })

  it('cannot remove options below the minimum', () => {
    render(<Harness initial={{
      id: 'b', type: 'mcq', title: '', marks: 1,
      data: { items: [{ key: 'k', text: '', options: [{ key: 'a', text: '' }, { key: 'b', text: '' }] }] },
    }} />)
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    // part remove (enabled, 1 part min 0) then two option removes (disabled at the minimum of 2)
    expect(removeButtons.slice(1).every((b) => b.disabled)).toBe(true)
  })

  it('edits a list of short texts, keeping empty boxes for the child to fill', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'b', type: 'missing_sequence', title: '', marks: 5, data: { items: ['1', '', '3'] } }} />)
    fireEvent.click(screen.getByText('+ Add'))
    expect(spy.mock.lastCall[0].data.items).toEqual(['1', '', '3', ''])
    fireEvent.change(screen.getByLabelText('Shape (optional)'), { target: { value: 'train' } })
    expect(spy.mock.lastCall[0].data.shape).toBe('train')
  })

  it('picks a picture through the picture chooser', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'b', type: 'colour_picture', title: '', marks: 2, data: {} }} />)
    fireEvent.click(screen.getByText('Choose'))
    fireEvent.click(screen.getByText('pick apple'))
    expect(spy.mock.lastCall[0].data.picture).toBe('apple')
  })

  it('a heading has no marks box', () => {
    render(<Harness initial={{ id: 'h', type: 'section_heading', title: 'Section A' }} />)
    expect(screen.getByLabelText('Heading')).toHaveValue('Section A')
    expect(screen.queryByText('Marks')).toBeNull()
  })

  it('shows the server problems for this block', () => {
    render(<BlockForm block={{ id: 'b', type: 'colour_picture', title: '', marks: 2, data: {} }} registry={registry}
      onChange={() => {}} problems={["'picture' is missing or has the wrong type."]} />)
    expect(screen.getByText("'picture' is missing or has the wrong type.")).toBeInTheDocument()
  })

  it('on an Urdu paper new text boxes open in Urdu and plain boxes follow the text direction', () => {
    render(
      <PaperDirectionContext.Provider value="rtl">
        <Harness initial={{ id: 'u', type: 'mcq', title: 'درست جواب چنیں', marks: 1, data: { items: [{ text: '', options: [{ text: '' }, { text: '' }] }] } }} />
      </PaperDirectionContext.Provider>,
    )
    expect(screen.getByLabelText('Question')).toHaveAttribute('data-language', 'ur')
    expect(screen.getByDisplayValue('درست جواب چنیں')).toHaveAttribute('dir', 'auto')
  })

  it('on an English paper text boxes open in English', () => {
    render(<Harness initial={{ id: 'e', type: 'mcq', title: 'Choose', marks: 1, data: { items: [{ text: '', options: [{ text: '' }, { text: '' }] }] } }} />)
    expect(screen.getByLabelText('Question')).toHaveAttribute('data-language', 'en')
  })
})

describe('openLanguage', () => {
  it('keeps the saved language, else follows the text, else the paper', () => {
    expect(openLanguage('<div dir="ltr" lang="en" class="">x</div>', 'ur').language).toBe('en')
    expect(openLanguage('<p>سیب</p>', 'en')).toEqual({ language: 'ur', inner: '<p>سیب</p>' })
    expect(openLanguage('', 'ur').language).toBe('ur')
    expect(openLanguage('<p>apple</p>').language).toBe('en')
  })

  it('keeps an emptied number box empty while typing, so 2 does not become 12 (demo findings A2)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'c', type: 'count_write', title: 'Count', marks: 5, data: { rows: [{ key: 'r1', count: 3 }] } }} />)
    const box = screen.getByLabelText('How many')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '' } })
    expect(box.value).toBe('')
    fireEvent.change(box, { target: { value: '2' } })
    expect(spy.mock.lastCall[0].data.rows[0].count).toBe(2)
    fireEvent.blur(box)
    expect(box.value).toBe('2')
  })

  it('applies the limits only when the number box is left', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'c', type: 'count_write', title: 'Count', marks: 5, data: { rows: [{ key: 'r1', count: 3 }] } }} />)
    const box = screen.getByLabelText('How many')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '12' } })
    expect(box.value).toBe('12')
    fireEvent.blur(box)
    expect(spy.mock.lastCall[0].data.rows[0].count).toBe(7)
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(spy.mock.lastCall[0].data.rows[0].count).toBe(3)
  })

  it('types marks over an emptied box without a leading zero', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'c', type: 'count_write', title: 'Count', marks: 5, data: { rows: [] } }} />)
    const marks = screen.getByDisplayValue('5')
    fireEvent.focus(marks)
    fireEvent.change(marks, { target: { value: '' } })
    fireEvent.change(marks, { target: { value: '4' } })
    expect(marks.value).toBe('4')
    expect(spy.mock.lastCall[0].marks).toBe(4)
  })

  it('opens the picture picker before adding a Count and write row (demo findings A5)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'c', type: 'count_write', title: 'Count', marks: 5, data: { rows: [{ key: 'r1', picture: 'cat', count: 3 }] } }} />)
    const before = spy.mock.calls.length
    fireEvent.click(screen.getByText('+ Add row'))
    expect(spy.mock.calls.length).toBe(before)
    fireEvent.click(screen.getByText('pick apple'))
    const rows = spy.mock.lastCall[0].data.rows
    expect(rows).toHaveLength(2)
    expect(rows[1].picture).toBe('apple')
    expect(rows[1].count).toBe(3)
  })

  it('splits a typed list on commas, keeping empty places, or on spaces (demo findings B1)', () => {
    expect(splitListText('1, , 3, , 5')).toEqual(['1', '', '3', '', '5'])
    expect(splitListText('4 5 2 4')).toEqual(['4', '5', '2', '4'])
    expect(splitListText('1,2,3', 2)).toEqual(['1', '2'])
  })

  it('fills a whole sequence from one line and adds the next box on Enter (B1, B2)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'm', type: 'missing_sequence', title: 'Missing', marks: 5, data: { items: [] } }} />)
    const all = screen.getByLabelText('Sequence: type them all')
    fireEvent.change(all, { target: { value: '1, , 3, ' } })
    fireEvent.keyDown(all, { key: 'Enter' })
    expect(spy.mock.lastCall[0].data.items).toEqual(['1', '', '3', ''])
    const last = screen.getByLabelText('Sequence 4')
    fireEvent.keyDown(last, { key: 'Enter' })
    expect(spy.mock.lastCall[0].data.items).toHaveLength(5)
    expect(document.activeElement).toBe(screen.getByLabelText('Sequence 5'))
  })

  it('counts 1 to N with every k-th box left empty in one step (faster 1)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'm', type: 'missing_sequence', title: 'Missing', marks: 5, data: { items: [] } }} />)
    fireEvent.change(screen.getByLabelText('Sequence: count up to'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Sequence: leave a box empty every'), { target: { value: '3' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Fill' })[1])
    expect(spy.mock.lastCall[0].data.items).toEqual(['1', '2', '', '4', '5', ''])
  })

  it('fills Count and write rows from typed picture names and lists the unknown ones (faster 4)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{ id: 'c', type: 'count_write', title: 'Count', marks: 5, data: { rows: [{ key: 'r1', picture: '', count: 3 }] } }} />)
    const box = screen.getByLabelText('Rows: picture names')
    fireEvent.change(box, { target: { value: 'butterfly 3, Flower 9, unicorn 2' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const rows = spy.mock.lastCall[0].data.rows
    expect(rows.map((r) => [r.picture, r.count])).toEqual([['butterfly', 3], ['flower', 7]])  // blank row replaced, 9 kept to max 7
    expect(screen.getByRole('status').textContent).toMatch(/Not in the library: unicorn/)
    expect(box.value).toBe('unicorn')
  })
})
