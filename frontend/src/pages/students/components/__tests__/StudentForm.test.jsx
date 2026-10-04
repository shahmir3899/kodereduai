import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StudentForm from '../StudentForm'
import { useStudentForm } from '../../../../hooks/useStudentForm'
import { STUDENT_FIELDS } from '../../studentFieldConfig'
import { emptyStudentForm } from '../../studentFormUtils'

// Wires the stateless form to the hook the way the pages will.
function Harness({ student = null, formProps = {}, onReady }) {
  const form = useStudentForm(student)
  onReady?.(form)
  return (
    <StudentForm
      values={form.values}
      errors={form.errors}
      onChange={form.setField}
      {...formProps}
    />
  )
}

const student = {
  name: 'Ali Hassan', roll_number: '4', parent_name: 'Hassan Sr', parent_phone: '0300-1111111',
  guardian_email: 'g@example.com', gender: 'Male', date_of_birth: '2015-04-02',
}

describe('StudentForm', () => {
  it('renders a labelled control for every configured field, grouped under section headings', () => {
    render(<StudentForm values={emptyStudentForm()} onChange={() => {}} />)

    for (const field of STUDENT_FIELDS) {
      expect(screen.getByLabelText(new RegExp(`^${field.label}`))).toBeInTheDocument()
    }
    for (const heading of ['Basic', 'Personal', 'Guardian', 'Admission']) {
      expect(screen.getByText(heading)).toBeInTheDocument()
    }
  })

  it('renders only the requested sections, without headings when it is just one', () => {
    render(<StudentForm values={emptyStudentForm()} onChange={() => {}} sections={['guardian']} />)

    expect(screen.getByLabelText('Guardian name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Student name *')).not.toBeInTheDocument()
    expect(screen.queryByText('Guardian')).not.toBeInTheDocument()
  })

  it('shows the values of the student being edited', () => {
    render(<Harness student={student} />)

    expect(screen.getByLabelText(/student name/i)).toHaveValue('Ali Hassan')
    expect(screen.getByLabelText('Gender')).toHaveValue('M')
    expect(screen.getByLabelText('Date of birth')).toHaveValue('2015-04-02')
  })

  it('updates the field and reports dirty state as the user types', async () => {
    const user = userEvent.setup()
    let form
    render(<Harness student={student} onReady={(f) => { form = f }} />)
    expect(form.isDirty).toBe(false)

    const name = screen.getByLabelText(/student name/i)
    await user.clear(name)
    await user.type(name, 'Ali H.')

    expect(name).toHaveValue('Ali H.')
    expect(form.isDirty).toBe(true)
    expect(form.getPayload()).toEqual({ name: 'Ali H.' })
  })

  it('marks required fields and shows the error under the field with aria wiring', () => {
    render(
      <StudentForm
        values={emptyStudentForm()}
        errors={{ roll_number: 'Roll number is required' }}
        onChange={() => {}}
      />,
    )

    const roll = screen.getByLabelText(/roll number/i)
    expect(roll).toHaveAttribute('aria-invalid', 'true')
    expect(roll).toHaveAccessibleDescription('Roll number is required')
    expect(screen.getByRole('alert')).toHaveTextContent('Roll number is required')
  })

  it('moves focus to the first invalid field in form order', () => {
    render(
      <StudentForm
        values={emptyStudentForm()}
        errors={{ guardian_email: 'Enter a valid email address', name: 'Student name is required' }}
        onChange={() => {}}
      />,
    )

    expect(screen.getByLabelText(/student name/i)).toHaveFocus()
  })

  it('clears a field error when that field is edited', async () => {
    const user = userEvent.setup()
    function Wrapper() {
      const form = useStudentForm(null)
      const [seeded, setSeeded] = useState(false)
      if (!seeded) {
        setSeeded(true)
        form.applyServerError({ response: { status: 400, data: { roll_number: ['Taken'] } } })
      }
      return <StudentForm values={form.values} errors={form.errors} onChange={form.setField} />
    }
    render(<Wrapper />)
    expect(screen.getByRole('alert')).toHaveTextContent('Taken')

    await user.type(screen.getByLabelText(/roll number/i), '7')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers the roll suggestion and applies it on click', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <StudentForm
        values={emptyStudentForm()}
        onChange={() => {}}
        rollSuggestion="12"
        onApplyRollSuggestion={onApply}
      />,
    )

    expect(screen.getByText('Next available roll in this class: 12')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Suggest 12' }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('tells the page when the user types their own roll number', async () => {
    const user = userEvent.setup()
    const onRollTyped = vi.fn()
    render(<StudentForm values={emptyStudentForm()} onChange={() => {}} onRollTyped={onRollTyped} />)

    await user.type(screen.getByLabelText(/roll number/i), '5')

    expect(onRollTyped).toHaveBeenCalled()
  })

  it('hides fields rejected by fieldFilter, and a section with nothing left disappears with its heading', () => {
    render(
      <StudentForm
        values={emptyStudentForm()}
        onChange={() => {}}
        fieldFilter={(f) => f.quick}
        showSectionHeadings
      />,
    )

    expect(screen.getByLabelText(/student name/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Parent phone')).toBeInTheDocument()
    expect(screen.queryByLabelText('Guardian email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument()
    expect(screen.queryByText('Personal')).not.toBeInTheDocument()
    expect(screen.queryByText('Admission')).not.toBeInTheDocument()
    expect(screen.getByText('Basic')).toBeInTheDocument()
    expect(screen.getByText('Guardian')).toBeInTheDocument()
  })

  it('renders the class slot at the top of the basic section', () => {
    render(
      <StudentForm
        values={emptyStudentForm()}
        onChange={() => {}}
        classSlot={<p>Class: 5-A (2025-2026)</p>}
      />,
    )

    expect(screen.getByText('Class: 5-A (2025-2026)')).toBeInTheDocument()
  })

  it('disables every control while saving', () => {
    render(<StudentForm values={emptyStudentForm()} onChange={() => {}} disabled />)

    for (const field of STUDENT_FIELDS) {
      expect(screen.getByLabelText(new RegExp(`^${field.label}`))).toBeDisabled()
    }
  })

  it('shows a WhatsApp link next to the parent phone once a number is entered', () => {
    render(<StudentForm values={{ ...emptyStudentForm(), parent_phone: '+923001111111' }} onChange={() => {}} />)

    expect(screen.getByRole('link', { name: /open whatsapp chat/i })).toHaveAttribute(
      'href',
      'https://wa.me/923001111111',
    )
  })
})
