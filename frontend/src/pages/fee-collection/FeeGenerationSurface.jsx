import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import ClassSelector from '../../components/ClassSelector'
import { useToast } from '../../components/Toast'
import { MONTHS } from './FeeFilters'
import { financeApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'
import {
	buildSessionClassOptions,
	resolveClassIdToMasterClassId,
} from '../../utils/classScope'

const FEE_TYPE_TABS = [
	{ value: 'MONTHLY', label: 'Monthly', caption: 'Recurring monthly records' },
	{ value: 'ANNUAL', label: 'Annual', caption: 'Category-based annual records' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2]

function formatGenerationResult(payload, options = {}) {
	const result = payload?.result || payload || {}
	const created = result.created
	const updated = result.updated ?? 0
	const deletedRecreated = result.deleted_recreated ?? 0
	const skipped = result.skipped ?? 0
	const protectedConflict = result.protected_conflict ?? 0
	const noFeeStructure = result.no_fee_structure ?? 0

	if (created == null) return options.fallbackMessage || 'Fee generation started. Track progress in Tasks.'

	return [
		`Created ${created} records.`,
		updated > 0 ? `Updated ${updated}.` : null,
		deletedRecreated > 0 ? `Recreated ${deletedRecreated}.` : null,
		skipped > 0 ? `Skipped ${skipped}.` : null,
		protectedConflict > 0 ? `${protectedConflict} protected conflict${protectedConflict === 1 ? '' : 's'} left unchanged.` : null,
		options.includeNoFeeStructure !== false && noFeeStructure > 0 ? `${noFeeStructure} students have no fee structure.` : null,
	].filter(Boolean).join(' ')
}

function CategoryPicker({
	title,
	required = false,
	categories,
	selectedIds,
	onChange,
	helperText,
	emptyText,
	actionText,
}) {
	const countLabel = selectedIds.length > 0
		? `${selectedIds.length} selected`
		: required
			? 'Required'
			: `All ${categories.length || 0} categories`

	return (
		<div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
			<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<label className="block text-sm font-medium text-gray-800">
						{title} {required && <span className="text-red-500">*</span>}
					</label>
					<p className="text-xs text-gray-500">{helperText}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
						{countLabel}
					</span>
					{categories.length > 0 && (
						<>
							<button
								type="button"
								onClick={() => onChange(categories.map((category) => category.id))}
								className="text-xs font-medium text-primary-700 hover:text-primary-800"
							>
								All
							</button>
							<button
								type="button"
								onClick={() => onChange([])}
								className="text-xs font-medium text-gray-600 hover:text-gray-800"
							>
								None
							</button>
						</>
					)}
				</div>
			</div>

			{categories.length === 0 ? (
				<div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
					<p>{emptyText}</p>
					{actionText && <p className="mt-1 font-medium text-amber-800">{actionText}</p>}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{categories.map((category) => (
						<label key={category.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-200">
							<input
								type="checkbox"
								checked={selectedIds.includes(category.id)}
								onChange={(event) => {
									if (event.target.checked) onChange([...selectedIds, category.id])
									else onChange(selectedIds.filter((id) => id !== category.id))
								}}
								className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
							/>
							<span>{category.name}</span>
						</label>
					))}
				</div>
			)}
		</div>
	)
}

function ConflictStrategyFieldset({ value, onChange, radioName, show }) {
	if (!show) return null

	return (
		<fieldset className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3" aria-describedby={`${radioName}-hint`}>
			<legend className="mb-2 text-sm font-medium text-amber-900">Existing records found</legend>
			<p id={`${radioName}-hint`} className="mb-3 text-xs text-amber-700">
				Only records whose recalculated amounts differ will be updated or replaced. Matching records will still be skipped.
			</p>
			<div className="space-y-2">
				<label className="flex items-start gap-2 cursor-pointer">
					<input type="radio" name={radioName} value="skip" checked={value === 'skip'} onChange={(event) => onChange(event.target.value)} className="mt-0.5 border-amber-300 text-amber-600 focus:ring-amber-500" />
					<span className="text-sm text-amber-800">Skip conflicting existing records</span>
				</label>
				<label className="flex items-start gap-2 cursor-pointer">
					<input type="radio" name={radioName} value="update" checked={value === 'update'} onChange={(event) => onChange(event.target.value)} className="mt-0.5 border-amber-300 text-amber-600 focus:ring-amber-500" />
					<span className="text-sm text-amber-800">Update existing records to current fee structure</span>
				</label>
				<label className="flex items-start gap-2 cursor-pointer">
					<input type="radio" name={radioName} value="delete_recreate" checked={value === 'delete_recreate'} onChange={(event) => onChange(event.target.value)} className="mt-0.5 border-amber-300 text-amber-600 focus:ring-amber-500" />
					<span className="text-sm text-amber-800">Delete and recreate conflicting records</span>
				</label>
			</div>
			{value === 'delete_recreate' && (
				<p className="mt-3 text-xs text-red-700">Delete and recreate will reset the conflicting record and can remove recorded payment history.</p>
			)}
		</fieldset>
	)
}

export default function FeeGenerationSurface({
	mode = 'inline',
	show = true,
	onClose,
	month,
	year,
	classList,
	monthlyMutation,
	annualMutation,
	academicYearId,
	annualCategories = [],
	monthlyCategories = [],
}) {
	const isModal = mode === 'modal'
	const { activeSchool } = useAuth()
	const { showWarning, showError } = useToast()
	const [feeType, setFeeType] = useState('MONTHLY')
	const [conflictStrategy, setConflictStrategy] = useState('skip')
	const [showConfirm, setShowConfirm] = useState(false)
	const [showStudentList, setShowStudentList] = useState(false)
	const [selectedMonth, setSelectedMonth] = useState(month)
	const [selectedYear, setSelectedYear] = useState(year)
	const [classFilter, setClassFilter] = useState('')
	const [selectedAnnualCategories, setSelectedAnnualCategories] = useState([])
	const [selectedMonthlyCategories, setSelectedMonthlyCategories] = useState([])

	const isMonthly = feeType === 'MONTHLY'
	const stepLabel = isMonthly ? 'Quick Generate' : (showConfirm ? 'Step 2 of 2' : 'Step 1 of 2')
	const { sessionClasses } = useSessionClasses(academicYearId, activeSchool?.id)
	const classOptions = useMemo(() => {
		if (!academicYearId) return classList
		if (!sessionClasses?.length) return []
		return buildSessionClassOptions(sessionClasses)
	}, [academicYearId, classList, sessionClasses])
	const resolvedClassFilter = resolveClassIdToMasterClassId(classFilter, academicYearId, sessionClasses)

	const selectedClassLabel = classOptions.find((option) => String(option.id) === String(classFilter))?.label
		|| classList.find((option) => String(option.id) === String(classFilter))?.name
		|| 'All classes'

	const previewEnabled = show && (isMonthly ? selectedMonthlyCategories.length > 0 : selectedAnnualCategories.length > 0)
	const previewParams = useMemo(() => ({
		fee_type: feeType,
		year: selectedYear,
		month: isMonthly ? selectedMonth : 0,
		...(resolvedClassFilter && { class_id: resolvedClassFilter }),
		...(academicYearId && { academic_year: academicYearId }),
		...(isMonthly && selectedMonthlyCategories.length > 0 && { monthly_categories: selectedMonthlyCategories.join(',') }),
		...(!isMonthly && selectedAnnualCategories.length > 0 && { annual_categories: selectedAnnualCategories.join(',') }),
	}), [academicYearId, feeType, isMonthly, resolvedClassFilter, selectedAnnualCategories, selectedMonth, selectedMonthlyCategories, selectedYear])

	const { data: previewData, isFetching: previewLoading } = useQuery({
		queryKey: ['generate-preview', feeType, resolvedClassFilter, selectedMonth, selectedYear, academicYearId, selectedAnnualCategories, selectedMonthlyCategories],
		queryFn: () => financeApi.previewGeneration(previewParams),
		enabled: previewEnabled,
		staleTime: 30_000,
	})

	const preview = previewData?.data
	const hasPreviewWork = (preview?.will_create || 0) > 0 || (preview?.already_exist || 0) > 0

	const resetState = () => {
		setFeeType('MONTHLY')
		setConflictStrategy('skip')
		setShowConfirm(false)
		setShowStudentList(false)
		setSelectedMonth(month)
		setSelectedYear(year)
		setClassFilter('')
		setSelectedAnnualCategories([])
		setSelectedMonthlyCategories([])
		monthlyMutation?.reset?.()
		annualMutation?.reset?.()
	}

	useEffect(() => {
		if (!isModal) return
		if (show) resetState()
	}, [show])

	useEffect(() => {
		if (!isModal || !show) return
		if (!(monthlyMutation?.submittedTaskId || annualMutation?.isSuccess)) return

		const timer = setTimeout(() => {
			resetState()
			onClose?.()
		}, monthlyMutation?.submittedTaskId ? 300 : 1500)

		return () => clearTimeout(timer)
	}, [annualMutation?.isSuccess, isModal, monthlyMutation?.submittedTaskId, onClose, show])

	if (!show) return null

	const activeTab = FEE_TYPE_TABS.find((tab) => tab.value === feeType)

	const submitMonthly = () => {
		if (selectedMonthlyCategories.length === 0) {
			showWarning('Select at least one monthly category before generating records.')
			return
		}
		if (!preview || !hasPreviewWork) {
			showWarning('No monthly records available to generate for the selected scope.')
			return
		}

		const payload = {
			month: selectedMonth,
			year: selectedYear,
			conflict_strategy: conflictStrategy,
			...(resolvedClassFilter && { class_id: parseInt(resolvedClassFilter) }),
			...(academicYearId && { academic_year: academicYearId }),
			...(selectedMonthlyCategories.length > 0 && { monthly_category_ids: selectedMonthlyCategories }),
		}

		if (monthlyMutation?.trigger) monthlyMutation.trigger(payload)
		else monthlyMutation?.mutate(payload)
	}

	const submitAnnual = () => {
		if (selectedAnnualCategories.length === 0) {
			showWarning('Select at least one annual category before generating records.')
			return
		}
		if (!preview || !hasPreviewWork) {
			showWarning('No annual records available to generate for the selected scope.')
			return
		}

		annualMutation?.mutate({
			...(resolvedClassFilter && { class_id: parseInt(resolvedClassFilter) }),
			annual_category_ids: selectedAnnualCategories,
			year: selectedYear,
			conflict_strategy: conflictStrategy,
			...(academicYearId && { academic_year: academicYearId }),
		}, {
			onSuccess: () => {
				setShowConfirm(false)
				setSelectedAnnualCategories([])
			},
		})
	}

	useEffect(() => {
		if (isMonthly && monthlyMutation?.isError) {
			showError(getErrorMessage(monthlyMutation.error, 'Failed to generate monthly fees'))
		}
	}, [isMonthly, monthlyMutation?.isError, monthlyMutation?.error, showError])

	useEffect(() => {
		if (!isMonthly && annualMutation?.isError) {
			showError(getErrorMessage(annualMutation.error, 'Failed to generate annual fees'))
		}
	}, [isMonthly, annualMutation?.isError, annualMutation?.error, showError])

	const headerClass = isModal
		? 'sticky top-0 z-10 -mx-6 mb-5 flex flex-col gap-3 border-b border-gray-200 bg-white px-6 pb-4 pt-6 shadow-sm sm:flex-row sm:items-start sm:justify-between'
		: 'mb-5 flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between'
	const footerClass = isModal
		? 'sticky bottom-0 z-10 -mx-6 mt-6 border-t border-gray-200 bg-white px-6 pb-6 pt-4'
		: 'mt-6'

	const content = (
		<div className={isModal ? 'px-6' : ''}>
			<div className={headerClass}>
				<div>
					<div className="mb-2 flex flex-wrap items-center gap-2">
						<h3 className="text-lg font-semibold text-gray-900">Generate Fee Records</h3>
						<span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
							{stepLabel}
						</span>
					</div>
					<p className="text-sm text-gray-600">
						{isMonthly
							? 'Generate recurring monthly records with carry-forward balances.'
							: 'Generate annual records from selected categories before collection starts.'}
					</p>
				</div>
				<div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Select monthly or annual fee generation">
					{FEE_TYPE_TABS.map((tab) => (
						<button
							key={tab.value}
							type="button"
							role="tab"
							aria-selected={feeType === tab.value}
							onClick={() => {
								setFeeType(tab.value)
								setShowConfirm(false)
								setShowStudentList(false)
							}}
							className={`rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
								feeType === tab.value
									? 'bg-primary-600 text-white shadow-sm'
									: 'bg-gray-100 text-gray-600 hover:bg-gray-200'
							}`}
						>
							<span className="block">{tab.label}</span>
							<span className={`block text-[11px] ${feeType === tab.value ? 'text-primary-100' : 'text-gray-400'}`}>{tab.caption}</span>
						</button>
					))}
				</div>
			</div>

			<div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
				{isMonthly && (
					<div>
						<label className="mb-1 block text-xs font-medium text-gray-500">Month</label>
						<select value={selectedMonth} onChange={(event) => setSelectedMonth(parseInt(event.target.value))} className="input-field text-sm">
							{MONTHS.map((monthLabel, index) => <option key={monthLabel} value={index + 1}>{monthLabel}</option>)}
						</select>
					</div>
				)}
				<div>
					<label className="mb-1 block text-xs font-medium text-gray-500">Year</label>
					<select value={selectedYear} onChange={(event) => setSelectedYear(parseInt(event.target.value))} className="input-field text-sm">
						{YEAR_OPTIONS.map((optionYear) => <option key={optionYear} value={optionYear}>{optionYear}</option>)}
					</select>
				</div>
			</div>

			<div className="mb-5">
				<label className="mb-1 block text-sm font-medium text-gray-700">Class</label>
				<ClassSelector
					value={classFilter}
					onChange={(event) => {
						setClassFilter(event.target.value)
						setShowConfirm(false)
						setShowStudentList(false)
					}}
					className="input-field"
					showAllOption
					classes={classOptions}
				/>
				<p className="mt-1 text-xs text-gray-500">Current scope: {selectedClassLabel}</p>
			</div>

			{isMonthly ? (
				<CategoryPicker
					title="Monthly Categories"
					required
					categories={monthlyCategories}
					selectedIds={selectedMonthlyCategories}
					onChange={(next) => {
						setSelectedMonthlyCategories(next)
						setShowConfirm(false)
					}}
					helperText="Required. Choose one or more monthly categories to preview and generate records."
					emptyText="No monthly categories defined. Set them up in Monthly Structure before generating monthly records."
					actionText="Monthly generation cannot proceed until at least one active monthly category exists."
				/>
			) : (
				<CategoryPicker
					title="Annual Categories"
					required
					categories={annualCategories}
					selectedIds={selectedAnnualCategories}
					onChange={(next) => {
						setSelectedAnnualCategories(next)
						setShowConfirm(false)
					}}
					helperText="Required. Choose one or more annual categories to preview and generate."
					emptyText="No annual categories defined. Set them up in Annual Charges before generating annual fee records."
					actionText="Annual generation cannot proceed until at least one active annual category exists."
				/>
			)}

			<div aria-live="polite">
				{isMonthly && (
					<div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/70 p-4 text-sm text-sky-900">
						Create monthly fee records for <strong>{selectedClassLabel}</strong> for <strong>{MONTHS[selectedMonth - 1]} {selectedYear}</strong>. Unpaid balances from the previous month will be carried forward automatically.
					</div>
				)}

				{!isMonthly && selectedAnnualCategories.length === 0 && (
					<p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Select at least one annual category to preview and generate annual records.</p>
				)}
				{isMonthly && selectedMonthlyCategories.length === 0 && (
					<p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Select at least one monthly category to preview and generate monthly records.</p>
				)}

				{previewLoading && previewEnabled && <p className="mb-4 text-sm text-gray-400">Calculating preview...</p>}

				{preview && !previewLoading && (
					<div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
							<div className="space-y-1">
								<p className="text-sm font-medium text-blue-900">
									{preview.will_create} new {activeTab?.label.toLowerCase()} record{preview.will_create === 1 ? '' : 's'}
									{preview.will_create > 0 && <> (total: <span className="font-semibold">{Number(preview.total_amount).toLocaleString()}</span>)</>}
								</p>
								{preview.already_exist > 0 && <p className="text-xs text-blue-700">{preview.already_exist} already exist and may need conflict handling.</p>}
								{preview.no_fee_structure > 0 && <p className="text-xs text-amber-700">{preview.no_fee_structure} students have no fee structure and will be skipped.</p>}
							</div>
							{!isMonthly && preview.will_create > 0 && (
								<button
									type="button"
									onClick={() => setShowStudentList(!showStudentList)}
									className="text-xs font-medium text-blue-700 hover:text-blue-900"
								>
									{showStudentList ? 'Hide' : 'Show'} student preview{preview.has_more ? ' (first 50)' : ''}
								</button>
							)}
						</div>
					</div>
				)}
			</div>

			{showStudentList && preview?.students?.length > 0 && !isMonthly && (
				<div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-gray-200">
					<table className="min-w-full text-xs">
						<thead className="sticky top-0 bg-gray-50">
							<tr>
								<th scope="col" className="px-2 py-1 text-left text-gray-500">Student</th>
								<th scope="col" className="px-2 py-1 text-left text-gray-500">Category</th>
								<th scope="col" className="px-2 py-1 text-right text-gray-500">Amount</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{preview.students.map((student) => (
								<tr key={student.student_id}>
									<th scope="row" className="px-2 py-1 text-left font-normal text-gray-700">{student.student_name}</th>
									<td className="px-2 py-1 text-gray-600">{student.category || '—'}</td>
									<td className="px-2 py-1 text-right text-gray-900">{Number(student.amount).toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<ConflictStrategyFieldset
				value={conflictStrategy}
				onChange={setConflictStrategy}
				radioName={`${mode}-${feeType.toLowerCase()}-conflict-strategy`}
				show={preview?.already_exist > 0}
			/>

			{!isMonthly && showConfirm && (
				<div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
					<p className="mb-2 font-medium">Confirm annual fee generation</p>
					<div className="space-y-1 text-blue-800">
						<p><span className="font-medium">Class:</span> {selectedClassLabel}</p>
						<p><span className="font-medium">Categories:</span> {annualCategories.filter((category) => selectedAnnualCategories.includes(category.id)).map((category) => category.name).join(', ')}</p>
						<p><span className="font-medium">Year:</span> {selectedYear}</p>
						<p><span className="font-medium">Records:</span> {preview?.will_create || 0} new</p>
						<p><span className="font-medium">Total Amount:</span> {Number(preview?.total_amount || 0).toLocaleString()}</p>
					</div>
				</div>
			)}

			<div className={footerClass}>
				<div className="flex flex-col gap-3 sm:flex-row">
					{isModal && (
						<button type="button" onClick={() => { resetState(); onClose?.() }} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
							Cancel
						</button>
					)}
					{!isMonthly && showConfirm && (
						<button type="button" onClick={() => setShowConfirm(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
							Back
						</button>
					)}
					{!isMonthly && !showConfirm ? (
						<button
							type="button"
							onClick={() => {
								if (selectedAnnualCategories.length === 0) {
									showWarning('Select at least one annual category before reviewing generation.')
									return
								}
								if (!preview || !hasPreviewWork) {
									showWarning('No annual records available to generate for the selected scope.')
									return
								}
								setShowConfirm(true)
							}}
							disabled={previewLoading}
							className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
						>
							Review & Generate
						</button>
					) : isMonthly ? (
						<button
							type="button"
							onClick={submitMonthly}
							disabled={monthlyMutation?.isSubmitting ?? monthlyMutation?.isPending}
							className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
						>
							{(monthlyMutation?.isSubmitting ?? monthlyMutation?.isPending) ? 'Starting...' : 'Generate Monthly Fees'}
						</button>
					) : (
						<button
							type="button"
							onClick={submitAnnual}
							disabled={annualMutation?.isSubmitting ?? annualMutation?.isPending}
							className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
						>
							{(annualMutation?.isSubmitting ?? annualMutation?.isPending) ? 'Generating...' : 'Confirm & Generate'}
						</button>
					)}
				</div>
			</div>

			{isMonthly && monthlyMutation?.isSuccess && (
				<div className="mt-3 rounded bg-green-50 p-3 text-sm text-green-700">
					{formatGenerationResult(monthlyMutation.data?.data, { fallbackMessage: 'Monthly fee generation started. Track progress in Tasks.' })}
				</div>
			)}
			{!isMonthly && annualMutation?.isSuccess && (
				<div className="mt-3 rounded bg-green-50 p-3 text-sm text-green-700">
					{formatGenerationResult(annualMutation.data?.data, { fallbackMessage: 'Annual fee generation started. Track progress in Tasks.', includeNoFeeStructure: false })}
				</div>
			)}
			{isMonthly && monthlyMutation?.isError && (
				<p className="mt-3 text-sm text-red-600">{getErrorMessage(monthlyMutation.error, 'Failed to generate monthly fees')}</p>
			)}
			{!isMonthly && annualMutation?.isError && (
				<p className="mt-3 text-sm text-red-600">{getErrorMessage(annualMutation.error, 'Failed to generate annual fees')}</p>
			)}
		</div>
	)

	if (!isModal) return content

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
			<div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg bg-white shadow-xl">
				{content}
			</div>
		</div>
	)
}
