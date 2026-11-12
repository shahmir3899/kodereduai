import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Routes, Route } from 'react-router-dom'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import ChildAttendance from '../parent/ChildAttendance'
import ChildTimetable from '../parent/ChildTimetable'
import ChildFees from '../parent/ChildFees'

vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 7, name: '2026-27' }, loading: false }),
}))

const at = (ui, path) => renderWithProviders(
  <Routes><Route path="/parent/children/:studentId/*" element={ui} /></Routes>,
  { route: path },
)

describe('ChildAttendance', () => {
  it('reads the plain list the endpoint returns and counts late and leave as present', async () => {
    const d = new Date()
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    server.use(
      http.get('*/api/parents/children/5/attendance/', () => HttpResponse.json([
        { id: 1, date: `${ym}-02`, status: 'PRESENT', branch: null },
        { id: 2, date: `${ym}-03`, status: 'LATE', branch: null },
        { id: 3, date: `${ym}-04`, status: 'LEAVE', branch: null },
        { id: 4, date: `${ym}-05`, status: 'ABSENT', branch: null },
      ])),
      http.get('*/api/sessions/calendar-entries/day-status/', () => HttpResponse.json({ days: {} })),
    )
    at(<ChildAttendance />, '/parent/children/5/attendance')
    expect(await screen.findByText('75%')).toBeInTheDocument() // (1 present + 1 late + 1 leave) / 4
  })
})

describe('ChildTimetable', () => {
  it('places entries on their day when the API sends day codes', async () => {
    server.use(http.get('*/api/parents/children/5/timetable/', () => HttpResponse.json([
      { id: 1, day: 'MON', day_display: 'Monday', slot_name: 'P1', start_time: '08:00:00', end_time: '08:40:00', subject: 'Maths', teacher: 'Ms A', room: null },
      { id: 2, day: 'TUE', day_display: 'Tuesday', slot_name: 'P1', start_time: '08:00:00', end_time: '08:40:00', subject: 'Science', teacher: 'Ms B', room: null },
    ])))
    at(<ChildTimetable />, '/parent/children/5/timetable')
    expect((await screen.findAllByText('Maths')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Science').length).toBeGreaterThan(0)
  })
})

describe('ChildFees', () => {
  it('shows month names, the active year only, and a tab for an earlier branch', async () => {
    const base = { fee_type: 'MONTHLY', fee_type_display: 'Monthly', previous_balance: '0.00', amount_due: '1000.00', amount_paid: '1000.00', status: 'PAID', kuickpay: null }
    server.use(
      http.get('*/api/parents/children/5/fees/', () => HttpResponse.json([
        { ...base, id: 1, academic_year: 7, month: 9, year: 2026, branch: null },
        { ...base, id: 2, academic_year: 6, month: 3, year: 2026, branch: null },
        { ...base, id: 3, academic_year: 2, month: 5, year: 2025, branch: 'Old Branch', read_only: true },
      ])),
      http.get('*/api/parents/children/5/kuickpay-bill/', () => HttpResponse.json({ enabled: false })),
    )
    at(<ChildFees />, '/parent/children/5/fees')
    expect((await screen.findAllByText('September')).length).toBeGreaterThan(0)
    expect(screen.queryByText('March')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Earlier · Old Branch/ })).toBeInTheDocument()
  })
})
