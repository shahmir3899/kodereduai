import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DeleteStudentModal, { namesMatch } from '../components/DeleteStudentModal'

const student = { id: 7, name: 'Muhammad Abbas Jan', roll_number: '36' }

describe('namesMatch', () => {
  it('ignores case and surrounding spaces but not different names', () => {
    expect(namesMatch('  muhammad abbas jan ', 'Muhammad Abbas Jan')).toBe(true)
    expect(namesMatch('Kayan Abbas', 'Muhammad Abbas Jan')).toBe(false)
    expect(namesMatch('', 'Muhammad Abbas Jan')).toBe(false)
  })
})

describe('DeleteStudentModal', () => {
  it('keeps Remove disabled until the student name is typed back', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<DeleteStudentModal student={student} isPending={false} onCancel={() => {}} onConfirm={onConfirm} />)

    const remove = screen.getByRole('button', { name: 'Remove student' })
    expect(remove).toBeDisabled()

    await user.type(screen.getByLabelText(/Type "Muhammad Abbas Jan"/), 'Kayan Abbas')
    expect(remove).toBeDisabled()

    await user.clear(screen.getByLabelText(/Type "Muhammad Abbas Jan"/))
    await user.type(screen.getByLabelText(/Type "Muhammad Abbas Jan"/), 'muhammad abbas jan')
    expect(remove).toBeEnabled()
  })

  it('passes the optional reason to onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<DeleteStudentModal student={student} isPending={false} onCancel={() => {}} onConfirm={onConfirm} />)

    await user.type(screen.getByLabelText(/Type "Muhammad Abbas Jan"/), student.name)
    await user.type(screen.getByLabelText('Reason (optional)'), ' duplicate entry ')
    await user.click(screen.getByRole('button', { name: 'Remove student' }))

    expect(onConfirm).toHaveBeenCalledWith('duplicate entry')
  })

  it('says the records are kept and can be restored', () => {
    render(<DeleteStudentModal student={student} isPending={false} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText(/are kept/)).toBeInTheDocument()
    expect(screen.getByText(/Recently deleted/)).toBeInTheDocument()
  })
})
