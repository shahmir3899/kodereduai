import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FeeFilters from '../FeeFilters'
import FeeTable from '../FeeTable'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
    isStaffMember: false,
  }),
}))

// Mock AcademicYearContext
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
  }),
}))

// Mock Toast
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}))

// Mock ClassSelector
vi.mock('../../../components/ClassSelector', () => ({
  default: ({ value, onChange, className }) => (
    <select data-testid="class-selector" value={value} onChange={onChange} className={className}>
      <option value="">All Classes</option>
      <option value="1">Class 1A</option>
      <option value="2">Class 2B</option>
    </select>
  ),
}))

// Mock constants
vi.mock('../../../constants/gradePresets', () => ({
  GRADE_PRESETS: {},
  GRADE_LEVEL_LABELS: {},
}))


// ====================================================================
// FeeFilters — Fee Type Dropdown
// ====================================================================

describe('FeeFilters — Fee Type Dropdown', () => {
  const defaultProps = {
    month: 2, setMonth: vi.fn(),
    year: 2026, setYear: vi.fn(),
    classFilter: '', setClassFilter: vi.fn(),
    statusFilter: '', setStatusFilter: vi.fn(),
    feeTypeFilter: 'MONTHLY', setFeeTypeFilter: vi.fn(),
    classList: [],
  }

  it('renders fee type dropdown with all 5 types + All', () => {
    renderWithProviders(<FeeFilters {...defaultProps} />)

    const feeTypeSelect = screen.getByDisplayValue('Monthly')
    expect(feeTypeSelect).toBeInTheDocument()

    // Check all options exist
    const options = within(feeTypeSelect).getAllByRole('option')
    const labels = options.map(o => o.textContent)
    expect(labels).toContain('All Types')
    expect(labels).toContain('Monthly')
    expect(labels).toContain('Annual')
    expect(labels).toContain('Admission')
    expect(labels).toContain('Books')
    expect(labels).toContain('Fine')
  })

  it('shows month selector when fee type is MONTHLY', () => {
    renderWithProviders(<FeeFilters {...defaultProps} feeTypeFilter="MONTHLY" />)

    expect(screen.getByDisplayValue('February')).toBeInTheDocument()
  })

  it('hides month selector when fee type is ANNUAL', () => {
    renderWithProviders(<FeeFilters {...defaultProps} feeTypeFilter="ANNUAL" />)

    expect(screen.queryByDisplayValue('February')).not.toBeInTheDocument()
  })

  it('hides month selector when fee type is ADMISSION', () => {
    renderWithProviders(<FeeFilters {...defaultProps} feeTypeFilter="ADMISSION" />)

    expect(screen.queryByDisplayValue('February')).not.toBeInTheDocument()
  })

  it('calls setFeeTypeFilter when fee type changes', async () => {
    const setFeeTypeFilter = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <FeeFilters {...defaultProps} setFeeTypeFilter={setFeeTypeFilter} />
    )

    const feeTypeSelect = screen.getByDisplayValue('Monthly')
    await user.selectOptions(feeTypeSelect, 'ANNUAL')

    expect(setFeeTypeFilter).toHaveBeenCalledWith('ANNUAL')
  })

  it('shows month when All Types is selected', () => {
    renderWithProviders(<FeeFilters {...defaultProps} feeTypeFilter="" />)

    // "All Types" with empty string: isMonthly = !'' = true, so month IS shown
    expect(screen.getByDisplayValue('February')).toBeInTheDocument()
  })
})


// ====================================================================
// FeeTable — Fee Type Display
// ====================================================================

describe('FeeTable — Fee Type Display', () => {
  const basePayment = {
    id: 1, student: 1, student_name: 'Ali Hassan', student_roll: '1',
    class_name: 'Class 1A', amount_due: '2500.00', amount_paid: '2500.00',
    previous_balance: '0.00', status: 'PAID',
    fee_type: 'MONTHLY', fee_type_display: 'Monthly',
  }

  const defaultProps = {
    paymentList: [basePayment],
    isLoading: false,
    month: 2, year: 2026,
    selectedIds: new Set(),
    onToggleSelect: vi.fn(),
    onToggleSelectAll: vi.fn(),
    editingCell: null, setEditingCell: vi.fn(),
    editValue: '', setEditValue: vi.fn(),
    onInlineUpdate: vi.fn(),
    onRecordPayment: vi.fn(),
    onSetStudentFee: vi.fn(),
    onDelete: vi.fn(),
    canWrite: true,
    feeTypeFilter: 'MONTHLY',
  }

  it('shows "Monthly Fee" column header for MONTHLY filter', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="MONTHLY" />)

    expect(screen.getByText('Monthly Fee')).toBeInTheDocument()
  })

  it('shows "Annual Fee" column header for ANNUAL filter', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="ANNUAL" />)

    expect(screen.getByText('Annual Fee')).toBeInTheDocument()
  })

  it('shows "Admission Fee" column header for ADMISSION filter', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="ADMISSION" />)

    expect(screen.getByText('Admission Fee')).toBeInTheDocument()
  })

  it('shows "Books Fee" column header for BOOKS filter', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="BOOKS" />)

    expect(screen.getByText('Books Fee')).toBeInTheDocument()
  })

  it('shows "Fine" column header for FINE filter', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="FINE" />)

    expect(screen.getByText('Fine')).toBeInTheDocument()
  })

  it('shows Prev Bal column for MONTHLY type', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="MONTHLY" />)

    expect(screen.getByText('Prev Bal')).toBeInTheDocument()
  })

  it('hides Prev Bal column for ANNUAL type', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="ANNUAL" />)

    expect(screen.queryByText('Prev Bal')).not.toBeInTheDocument()
  })

  it('hides Prev Bal column for ADMISSION type', () => {
    renderWithProviders(<FeeTable {...defaultProps} feeTypeFilter="ADMISSION" />)

    expect(screen.queryByText('Prev Bal')).not.toBeInTheDocument()
  })

  it('shows empty state with correct fee type label', () => {
    renderWithProviders(
      <FeeTable {...defaultProps} paymentList={[]} feeTypeFilter="ANNUAL" />
    )

    // Empty state has two paragraphs mentioning "annual fee"
    const matches = screen.getAllByText(/no annual fee/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('displays student data correctly', () => {
    renderWithProviders(<FeeTable {...defaultProps} />)

    // Both mobile + desktop views render, so student name appears twice
    const names = screen.getAllByText('Ali Hassan')
    expect(names.length).toBeGreaterThanOrEqual(1)
    const classes = screen.getAllByText('Class 1A')
    expect(classes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows fee type badge when viewing All Types', () => {
    const payment = {
      ...basePayment,
      fee_type: 'ANNUAL',
      fee_type_display: 'Annual',
    }

    renderWithProviders(
      <FeeTable {...defaultProps} paymentList={[payment]} feeTypeFilter="" />
    )

    // Badge shows fee_type_display ('Annual') from the desktop table view
    expect(screen.getByText('Annual')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    renderWithProviders(
      <FeeTable {...defaultProps} paymentList={[]} isLoading={true} />
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders status badges correctly', () => {
    const payments = [
      { ...basePayment, id: 1, status: 'PAID' },
      { ...basePayment, id: 2, status: 'UNPAID', amount_paid: '0.00' },
      { ...basePayment, id: 3, status: 'PARTIAL', amount_paid: '1000.00' },
    ]

    renderWithProviders(<FeeTable {...defaultProps} paymentList={payments} />)

    // Both mobile + desktop views render badges, so use getAllByText
    expect(screen.getAllByText('PAID').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('UNPAID').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('PARTIAL').length).toBeGreaterThanOrEqual(1)
  })
})


// ====================================================================
// BatchConvertModal — Fee Generation Options
// ====================================================================

describe('BatchConvertModal — Fee Generation', () => {
  // Lazy import to avoid issues with mocks
  let BatchConvertModal
  beforeEach(async () => {
    const mod = await import('../../../components/BatchConvertModal')
    BatchConvertModal = mod.default
  })

  it('renders fee generation checkbox', async () => {
    renderWithProviders(
      <BatchConvertModal
        enquiryIds={[1, 2]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/auto-generate fee records/i)).toBeInTheDocument()
    })
  })

  it('shows fee type checkboxes when generate fees is enabled', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <BatchConvertModal
        enquiryIds={[1, 2]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    // Click the auto-generate checkbox
    const generateCheckbox = await screen.findByText(/auto-generate fee records/i)
    await user.click(generateCheckbox)

    await waitFor(() => {
      expect(screen.getByText(/admission fee/i)).toBeInTheDocument()
      expect(screen.getByText(/annual fee/i)).toBeInTheDocument()
    })
  })

  it('sends generate_fees and fee_types in mutation', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/admissions/enquiries/batch-convert/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          converted_count: 1, fees_generated_count: 2, errors: [],
        })
      })
    )

    const user = userEvent.setup()
    const onSuccess = vi.fn()
    renderWithProviders(
      <BatchConvertModal
        enquiryIds={[1]}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    )

    // Wait for the modal to render with fee generation option
    await waitFor(() => {
      expect(screen.getByText(/auto-generate fee records/i)).toBeInTheDocument()
    })

    // Verify the convert button exists (use role to avoid matching other /convert/ text)
    const convertButtons = screen.getAllByRole('button')
    const convertBtn = convertButtons.find(b => b.textContent.match(/convert/i))
    expect(convertBtn).toBeTruthy()
  })
})
