import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import StudentsAtRiskCard from '../StudentsAtRiskCard'

const wrap = (props) => render(<MemoryRouter><StudentsAtRiskCard {...props} /></MemoryRouter>)

const DATA = {
  attendance: {
    at_risk_count: 3,
    students: [{
      student_id: 7, student_name: 'Ayesha', class_name: 'Grade 1 - A', severity: 'HIGH',
      current_rate: 54.5, consecutive_absent_days: 4, suggested_action: 'Call the parents.',
    }],
  },
  academic: {
    at_risk_count: 1,
    students: [{
      student_id: 9, student_name: 'Bilal', class_name: 'Grade 1 - A', severity: 'MEDIUM',
      current_average: 38, consecutive_fails: 2, suggested_action: 'Offer extra help.',
    }],
  },
}

describe('StudentsAtRiskCard', () => {
  it('shows both groups with metrics, actions and a link to the student', () => {
    wrap({ data: DATA })
    expect(screen.getByText('Ayesha')).toBeTruthy()
    expect(screen.getByText(/54.5% attendance · 4 days absent in a row/)).toBeTruthy()
    expect(screen.getByText('Call the parents.')).toBeTruthy()
    expect(screen.getByText(/38% average · failed 2 exam/)).toBeTruthy()
    expect(screen.getByText('Ayesha').closest('a').getAttribute('href')).toBe('/students/7')
    expect(screen.getByText('3 at risk', { exact: false })).toBeTruthy()
  })

  it('shows the empty message when neither list has students', () => {
    wrap({ data: { attendance: { students: [] }, academic: { students: [] } } })
    expect(screen.getByText(/No students in your sections/)).toBeTruthy()
  })

  it('shows an error, not the empty message, when the request failed', () => {
    wrap({ error: true })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/No students in your sections/)).toBeNull()
  })

  it('is the in-page target of the attention chip', () => {
    wrap({ data: DATA })
    expect(document.getElementById('students-at-risk')).toBeTruthy()
  })
})
