import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useFeeCollection } from './useFeeCollection'
import FeeFilters from './FeeFilters'
import FeeTable from './FeeTable'
import BulkActionsBar from './BulkActionsBar'
import {
  PaymentModal, GenerateModal, DeleteConfirmModal, CreateSingleFeeModal,
} from './FeeModals'
import { exportFeePDF } from './feeExport'
import { useToast } from '../../components/Toast'

export default function FeeCollectPage() {
  const { user, activeSchool, isStaffMember } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { showWarning } = useToast()
  const canWrite = !isStaffMember
  const now = new Date()
  const [searchParams] = useSearchParams()

  // Filter state — initialize from URL params if present
  const [month, setMonth] = useState(() => {
    const p = searchParams.get('month')
    return p ? parseInt(p) : now.getMonth() + 1
  })
  const [year, setYear] = useState(() => {
    const p = searchParams.get('year')
    return p ? parseInt(p) : now.getFullYear()
  })
  const [classFilter, setClassFilter] = useState(() => searchParams.get('class') || '')
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || '')
  const [feeTypeFilter, setFeeTypeFilter] = useState('MONTHLY')

  // Modal state
  const [showPaymentModal, setShowPaymentModal] = useState(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showCreateFeeModal, setShowCreateFeeModal] = useState(false)

  // Form state
  const [paymentForm, setPaymentForm] = useState({
    amount_paid: '', payment_method: 'CASH', receipt_number: '', notes: '',
    payment_date: new Date().toISOString().split('T')[0], account: ''
  })

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Inline editing state
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState(null)

  // Data hook
  const data = useFeeCollection({
    month, year, classFilter, statusFilter, feeTypeFilter,
    academicYearId: activeAcademicYear?.id,
  })

  // Deep-link: auto-scroll to specific student from URL
  const urlStudentId = searchParams.get('student')
  useEffect(() => {
    if (urlStudentId && data.paymentList.length > 0) {
      // Find the student's payment and auto-open payment modal
      const payment = data.paymentList.find(p => String(p.student_id || p.student) === urlStudentId)
      if (payment && payment.status !== 'PAID' && payment.status !== 'ADVANCE') {
        const balance = Math.max(0, Number(payment.amount_due) - Number(payment.amount_paid))
        setShowPaymentModal(payment)
        setPaymentForm(f => ({ ...f, amount_paid: String(balance) }))
      }
    }
  }, [urlStudentId, data.paymentList])

  // --- Handlers ---

  const handleRecordPayment = (e) => {
    e.preventDefault()
    if (!paymentForm.account) {
      showWarning('Please select an account')
      return
    }
    const formData = {
      ...paymentForm,
      amount_paid: parseFloat(paymentForm.amount_paid),
      account: parseInt(paymentForm.account),
    }
    data.paymentMutation.mutate({ id: showPaymentModal.id, data: formData }, {
      onSuccess: () => {
        setShowPaymentModal(null)
        setPaymentForm({ amount_paid: '', payment_method: 'CASH', receipt_number: '', notes: '', payment_date: new Date().toISOString().split('T')[0], account: '' })
      },
    })
  }

  const handleInlineUpdate = (id, field, value) => {
    const parsedValue = parseFloat(value)
    if (isNaN(parsedValue) || parsedValue < 0) {
      setEditingCell(null)
      return
    }
    const payment = data.paymentList.find(p => p.id === id)
    if (parsedValue > 0 && (!payment || !payment.account)) {
      setEditingCell(null)
      showWarning('Account required — opening payment form')
      if (payment) {
        const balance = Number(payment.amount_due) - Number(payment.amount_paid)
        handleOpenPayment(payment, balance)
      }
      return
    }
    const today = new Date().toISOString().split('T')[0]
    data.paymentMutation.mutate({ id, data: { [field]: parsedValue, payment_date: payment?.payment_date || today, ...(payment?.account && { account: payment.account }) } })
    setEditingCell(null)
  }

  const handleOpenPayment = (payment, balance) => {
    setShowPaymentModal(payment)
    setPaymentForm(f => ({ ...f, amount_paid: String(balance) }))
  }

  const handleToggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleSelectAll = (checked) => {
    if (checked) setSelectedIds(new Set(data.paymentList.map(p => p.id)))
    else setSelectedIds(new Set())
  }

  const handleBulkUpdate = (amount, accountId, paymentMethod = 'CASH') => {
    const today = new Date().toISOString().split('T')[0]
    const records = [...selectedIds].map(id => ({
      id, amount_paid: amount,
      payment_date: today,
      payment_method: paymentMethod,
      ...(accountId && { account: accountId }),
    }))
    data.bulkUpdateMutation.mutate({ records }, {
      onSuccess: () => setSelectedIds(new Set()),
    })
  }

  const handlePayFull = (accountId, paymentMethod = 'CASH') => {
    data.bulkUpdateMutation.mutate(
      { pay_full: true, ids: [...selectedIds], account: accountId, payment_method: paymentMethod },
      { onSuccess: () => setSelectedIds(new Set()) },
    )
  }

  const handleBulkDelete = () => setDeleteTarget('bulk')

  const handleDeleteConfirm = () => {
    if (deleteTarget === 'bulk') {
      data.bulkDeleteMutation.mutate({ ids: [...selectedIds] }, {
        onSuccess: () => { setSelectedIds(new Set()); setDeleteTarget(null) },
      })
    } else {
      data.deleteFeePaymentMutation.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      })
    }
  }

  const handleExportPDF = () => {
    exportFeePDF({
      paymentList: data.paymentList,
      month, year,
      summaryData: data.summaryData,
      schoolName: activeSchool?.name || user?.school_name,
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Collect Payments</h1>
          <p className="text-sm text-gray-600">Record student fee payments</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <>
              <button
                onClick={() => setShowCreateFeeModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Create Fee
              </button>
              <button
                onClick={() => setShowGenerateModal(true)}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
              >
                Generate Records
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sticky Toolbar: Filters + Export */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FeeFilters
            month={month} setMonth={setMonth}
            year={year} setYear={setYear}
            classFilter={classFilter} setClassFilter={setClassFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            feeTypeFilter={feeTypeFilter} setFeeTypeFilter={setFeeTypeFilter}
            classList={data.classList}
          />
          <div className="flex-1" />
          {data.paymentList.length > 0 && (
            <button
              onClick={handleExportPDF}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm whitespace-nowrap"
            >
              Export PDF
            </button>
          )}
        </div>
      </div>

      {/* Fee Table */}
      <FeeTable
        paymentList={data.paymentList}
        isLoading={data.isLoading}
        month={month} year={year}
        feeTypeFilter={feeTypeFilter}
        selectedIds={selectedIds}
        onToggleSelect={canWrite ? handleToggleSelect : undefined}
        onToggleSelectAll={canWrite ? handleToggleSelectAll : undefined}
        editingCell={editingCell} setEditingCell={canWrite ? setEditingCell : () => {}}
        editValue={editValue} setEditValue={setEditValue}
        onInlineUpdate={canWrite ? handleInlineUpdate : undefined}
        onRecordPayment={canWrite ? handleOpenPayment : undefined}
        onDelete={canWrite ? (id) => setDeleteTarget(id) : undefined}
        canWrite={canWrite}
      />

      {/* Bulk Actions */}
      {canWrite && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          onBulkUpdate={handleBulkUpdate}
          onPayFull={handlePayFull}
          onBulkDelete={handleBulkDelete}
          isPending={data.bulkUpdateMutation.isPending || data.bulkDeleteMutation.isPending}
          accountsList={data.accountsList}
          showWarning={showWarning}
        />
      )}

      {/* Modals */}
      <PaymentModal
        payment={showPaymentModal}
        form={paymentForm} setForm={setPaymentForm}
        onSubmit={handleRecordPayment}
        onClose={() => setShowPaymentModal(null)}
        isPending={data.paymentMutation.isPending}
        error={data.paymentMutation.isError ? data.paymentMutation.error : null}
        accountsList={data.accountsList}
      />

      <GenerateModal
        show={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        month={month} year={year}
        classList={data.classList}
        mutation={data.generateMutation}
        onetimeMutation={data.generateOnetimeMutation}
        academicYearId={activeAcademicYear?.id}
      />

      <DeleteConfirmModal
        show={deleteTarget !== null}
        message={
          deleteTarget === 'bulk'
            ? `Delete ${selectedIds.size} selected fee records? This cannot be undone.`
            : 'Delete this fee record? This cannot be undone.'
        }
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        isPending={data.deleteFeePaymentMutation.isPending || data.bulkDeleteMutation.isPending}
      />

      <CreateSingleFeeModal
        show={showCreateFeeModal}
        onClose={() => setShowCreateFeeModal(false)}
        onSubmit={(payload) => {
          data.createFeePaymentMutation.mutate(payload, {
            onSuccess: () => setShowCreateFeeModal(false),
          })
        }}
        isPending={data.createFeePaymentMutation.isPending}
        error={data.createFeePaymentMutation.isError ? data.createFeePaymentMutation.error : null}
        isSuccess={data.createFeePaymentMutation.isSuccess}
        classList={data.classList}
        activeSchoolId={activeSchool?.id}
        academicYearId={activeAcademicYear?.id}
        accountsList={data.accountsList}
      />
    </div>
  )
}
