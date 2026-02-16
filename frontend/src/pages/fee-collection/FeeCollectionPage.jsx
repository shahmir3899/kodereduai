import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useFeeData } from './useFeeData'
import FeeFilters, { MONTHS } from './FeeFilters'
import FeeSummaryCards, { ClassBreakdown, PendingStudents } from './FeeSummaryCards'
import FeeCharts from './FeeCharts'
import FeeTable from './FeeTable'
import BulkActionsBar from './BulkActionsBar'
import {
  PaymentModal, GenerateModal, FeeStructureModal,
  IncomeModal, StudentFeeModal, DeleteConfirmModal,
} from './FeeModals'
import { exportFeePDF } from './feeExport'

export default function FeeCollectionPage() {
  const { user, activeSchool, isStaffMember } = useAuth()
  const canWrite = !isStaffMember
  const now = new Date()

  // Filter state
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [classFilter, setClassFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [activeTab, setActiveTab] = useState('fees')

  // Analytics toggle
  const [showAnalytics, setShowAnalytics] = useState(false)

  // Modal state
  const [showPaymentModal, setShowPaymentModal] = useState(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showFeeStructureModal, setShowFeeStructureModal] = useState(false)
  const [showIncomeModal, setShowIncomeModal] = useState(false)
  const [showStudentFeeModal, setShowStudentFeeModal] = useState(null)

  // Form state
  const [paymentForm, setPaymentForm] = useState({
    amount_paid: '', payment_method: 'CASH', receipt_number: '', notes: '',
    payment_date: new Date().toISOString().split('T')[0], account: ''
  })
  const [incomeForm, setIncomeForm] = useState({
    category: 'SALE', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: ''
  })
  const [studentFeeAmount, setStudentFeeAmount] = useState('')

  // Selection state (new)
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Inline editing state (new)
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')

  // Delete confirmation state (new)
  const [deleteTarget, setDeleteTarget] = useState(null) // payment id or 'bulk'

  // Data hook
  const data = useFeeData({ month, year, classFilter, statusFilter })

  // --- Handlers ---

  const handleRecordPayment = (e) => {
    e.preventDefault()
    if (!paymentForm.account) {
      alert('Please select account')
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

  const handleBulkFeeSubmit = (e) => {
    e.preventDefault()
    const structures = Object.entries(data.bulkFees)
      .filter(([_, amount]) => amount && parseFloat(amount) > 0)
      .map(([classId, amount]) => ({ class_obj: parseInt(classId), monthly_amount: amount }))
    if (structures.length === 0) return
    data.bulkFeeMutation.mutate({ structures, effective_from: data.bulkEffectiveFrom }, {
      onSuccess: () => setShowFeeStructureModal(false),
    })
  }

  const handleAddIncome = (e) => {
    e.preventDefault()
    if (!incomeForm.account) {
      alert('Please select account')
      return
    }
    data.incomeMutation.mutate({
      ...incomeForm,
      amount: parseFloat(incomeForm.amount),
      account: parseInt(incomeForm.account),
    }, {
      onSuccess: () => {
        setShowIncomeModal(false)
        setIncomeForm({ category: 'SALE', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: '' })
      },
    })
  }

  const handleSetStudentFee = (e) => {
    e.preventDefault()
    if (!showStudentFeeModal || !studentFeeAmount) return
    data.studentFeeMutation.mutate({
      student: showStudentFeeModal.student_id,
      monthly_amount: studentFeeAmount,
      effective_from: new Date().toISOString().split('T')[0],
    }, {
      onSuccess: () => {
        setShowStudentFeeModal(null)
        setStudentFeeAmount('')
      },
    })
  }

  // Inline editing handler
  const handleInlineUpdate = (id, field, value) => {
    const parsedValue = parseFloat(value)
    if (isNaN(parsedValue) || parsedValue < 0) {
      setEditingCell(null)
      return
    }
    // Find payment to check if it has an account
    const payment = data.paymentList.find(p => p.id === id)
    if (parsedValue > 0 && (!payment || !payment.account)) {
      // No account set — redirect to PaymentModal
      setEditingCell(null)
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

  // Open record payment modal from table
  const handleOpenPayment = (payment, balance) => {
    setShowPaymentModal(payment)
    setPaymentForm(f => ({ ...f, amount_paid: String(balance) }))
  }

  // Open student fee modal from table
  const handleOpenStudentFee = (payment, monthlyFee) => {
    setShowStudentFeeModal({ student_id: payment.student, student_name: payment.student_name, class_name: payment.class_name })
    setStudentFeeAmount(String(monthlyFee))
  }

  // Selection handlers
  const handleToggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(data.paymentList.map(p => p.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  // Bulk update handler
  const handleBulkUpdate = (amount, accountId) => {
    const today = new Date().toISOString().split('T')[0]
    const records = [...selectedIds].map(id => ({
      id, amount_paid: amount,
      payment_date: today,
      ...(accountId && { account: accountId }),
    }))
    data.bulkUpdateMutation.mutate({ records }, {
      onSuccess: () => setSelectedIds(new Set()),
    })
  }

  // Bulk delete handler
  const handleBulkDelete = () => {
    setDeleteTarget('bulk')
  }

  // Delete confirmation handler
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

  // PDF export
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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Fee Collection</h1>
          <p className="text-sm text-gray-600">Manage student fee payments & other income</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <>
              <button
                onClick={() => setShowFeeStructureModal(true)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
              >
                Set Fee Structure
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('fees')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'fees' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Student Fees
        </button>
        <button
          onClick={() => setActiveTab('income')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'income' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Other Income
        </button>
      </div>

      {/* Student Fees Tab */}
      {activeTab === 'fees' && (
        <>
          {/* KPI Summary Cards — always visible */}
          <FeeSummaryCards summaryData={data.summaryData} />

          {/* Analytics Toggle */}
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className="flex items-center gap-2 mb-4 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showAnalytics ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showAnalytics ? 'Hide' : 'Show'} Analytics
          </button>

          {/* Collapsible Analytics Section */}
          {showAnalytics && (
            <div className="space-y-4 mb-4">
              <ClassBreakdown summaryData={data.summaryData} />
              <PendingStudents paymentList={data.paymentList} />
              <FeeCharts summaryData={data.summaryData} />
            </div>
          )}

          {/* Sticky Toolbar: Filters + Export */}
          <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <FeeFilters
                month={month} setMonth={setMonth}
                year={year} setYear={setYear}
                classFilter={classFilter} setClassFilter={setClassFilter}
                statusFilter={statusFilter} setStatusFilter={setStatusFilter}
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

          <FeeTable
            paymentList={data.paymentList}
            isLoading={data.isLoading}
            month={month} year={year}
            selectedIds={selectedIds}
            onToggleSelect={canWrite ? handleToggleSelect : undefined}
            onToggleSelectAll={canWrite ? handleToggleSelectAll : undefined}
            editingCell={editingCell} setEditingCell={canWrite ? setEditingCell : () => {}}
            editValue={editValue} setEditValue={setEditValue}
            onInlineUpdate={canWrite ? handleInlineUpdate : undefined}
            onRecordPayment={canWrite ? handleOpenPayment : undefined}
            onSetStudentFee={canWrite ? handleOpenStudentFee : undefined}
            onDelete={canWrite ? (id) => setDeleteTarget(id) : undefined}
            canWrite={canWrite}
          />

          {canWrite && (
            <BulkActionsBar
              selectedCount={selectedIds.size}
              onBulkUpdate={handleBulkUpdate}
              onBulkDelete={handleBulkDelete}
              isPending={data.bulkUpdateMutation.isPending || data.bulkDeleteMutation.isPending}
              accountsList={data.accountsList}
            />
          )}
        </>
      )}

      {/* Other Income Tab */}
      {activeTab === 'income' && (
        <OtherIncomeSection
          month={month} setMonth={setMonth}
          year={year} setYear={setYear}
          incomeList={data.incomeList}
          incomeLoading={data.incomeLoading}
          onAddIncome={() => setShowIncomeModal(true)}
          onDeleteIncome={(id) => data.deleteIncomeMutation.mutate(id)}
          canWrite={canWrite}
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
        classFilter={classFilter} setClassFilter={setClassFilter}
        classList={data.classList}
        mutation={data.generateMutation}
        existingCount={data.paymentList.length}
      />

      <FeeStructureModal
        show={showFeeStructureModal}
        onClose={() => setShowFeeStructureModal(false)}
        classList={data.classList}
        bulkFees={data.bulkFees} setBulkFees={data.setBulkFees}
        bulkEffectiveFrom={data.bulkEffectiveFrom} setBulkEffectiveFrom={data.setBulkEffectiveFrom}
        onSubmit={handleBulkFeeSubmit}
        mutation={data.bulkFeeMutation}
      />

      <IncomeModal
        show={showIncomeModal}
        onClose={() => setShowIncomeModal(false)}
        form={incomeForm} setForm={setIncomeForm}
        onSubmit={handleAddIncome}
        isPending={data.incomeMutation.isPending}
        error={data.incomeMutation.isError ? data.incomeMutation.error : null}
        accountsList={data.accountsList}
      />

      <StudentFeeModal
        student={showStudentFeeModal}
        amount={studentFeeAmount} setAmount={setStudentFeeAmount}
        onSubmit={handleSetStudentFee}
        onClose={() => { setShowStudentFeeModal(null); setStudentFeeAmount('') }}
        isPending={data.studentFeeMutation.isPending}
        error={data.studentFeeMutation.isError ? data.studentFeeMutation.error : null}
        isSuccess={data.studentFeeMutation.isSuccess}
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
    </div>
  )
}

// Other Income Section (kept inline since it's small)
function OtherIncomeSection({ month, setMonth, year, setYear, incomeList, incomeLoading, onAddIncome, onDeleteIncome, canWrite }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
            <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="input-field text-sm">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
            <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="input-field text-sm">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        {canWrite && (
          <button onClick={onAddIncome} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
            Add Income
          </button>
        )}
      </div>

      <div className="card">
        {incomeLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : incomeList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-2">No other income recorded for {MONTHS[month - 1]} {year}</p>
            <p className="text-sm text-gray-400">Click "Add Income" to record sales, donations, or other income</p>
          </div>
        ) : (
          <>
            <div className="mb-4 p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700">
                Total Other Income: <span className="font-bold text-lg">{incomeList.reduce((sum, i) => sum + Number(i.amount), 0).toLocaleString()}</span>
              </p>
            </div>

            {/* Mobile view */}
            <div className="sm:hidden space-y-3">
              {incomeList.map((item) => (
                <div key={item.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{item.category_display}</span>
                    <span className="font-bold text-green-700">{Number(item.amount).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-500">{item.date} {item.description && `\u2014 ${item.description}`}</p>
                  {canWrite && <button onClick={() => onDeleteIncome(item.id)} className="mt-2 text-xs text-red-600 hover:text-red-800">Delete</button>}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {incomeList.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.date}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.category_display}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.description || '\u2014'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-green-700 text-right">{Number(item.amount).toLocaleString()}</td>
                      {canWrite && (
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => onDeleteIncome(item.id)} className="text-sm text-red-600 hover:text-red-800">Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
