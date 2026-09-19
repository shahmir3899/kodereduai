import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExamPicker, StudentPicker } from '../ReportCardFilters'

const exams = [
  { id: 1, name: '1st Term Exam', term_name: '1st Term', exam_type_name: 'Term' },
  { id: 2, name: '2nd Term Exam', term_name: '2nd Term', exam_type_name: 'Term' },
  { id: 3, name: 'Final Exam', term_name: '3rd Term', exam_type_name: 'Final' },
  { id: 4, name: 'Quiz', term_name: '3rd Term', exam_type_name: 'Quiz' },
  { id: 5, name: 'Practical', term_name: '3rd Term', exam_type_name: 'Practical' },
]

describe('ExamPicker', () => {
  it('names the newest ticked exam and counts earlier ones', () => {
    render(<ExamPicker exams={exams} selected={['1', '3']} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Final Exam/ })).toHaveTextContent('+1 earlier')
  })

  it('never lets the last tick be removed and caps at four exams', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<ExamPicker exams={exams} selected={['3']} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /Final Exam/ }))
    await user.click(screen.getByRole('checkbox', { name: /Final Exam/ }))
    expect(onChange).not.toHaveBeenCalled()

    rerender(<ExamPicker exams={exams} selected={['1', '2', '3', '4']} onChange={onChange} />)
    expect(screen.getByRole('checkbox', { name: /Practical/ })).toBeDisabled()
    expect(screen.getByText(/At most 4 exams/)).toBeInTheDocument()
  })
})

describe('StudentPicker', () => {
  const students = [
    { id: 10, student_name: 'Ayesha', roll_number: '1' },
    { id: 11, student_name: 'Bilal', roll_number: '2' },
    { id: 12, student_name: 'Chand', roll_number: '3' },
  ]

  it('filters by typing and picks with a click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StudentPicker students={students} value="" onChange={onChange} />)
    await user.type(screen.getByLabelText('Student'), 'bil')
    expect(screen.queryByText('Ayesha')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Bilal/ }))
    expect(onChange).toHaveBeenCalledWith('11')
  })

  it('steps to the previous and next student', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StudentPicker students={students} value="11" onChange={onChange} />)
    await user.click(screen.getByLabelText('Next student'))
    expect(onChange).toHaveBeenLastCalledWith('12')
    await user.click(screen.getByLabelText('Previous student'))
    expect(onChange).toHaveBeenLastCalledWith('10')
  })
})
