import { useCallback, useMemo, useState } from 'react'
import { useToast } from '../../../components/Toast'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useRollSuggestion } from '../../../hooks/useRollSuggestion'
import { useDestinationClasses, useExitDestinations, useStudentExit } from '../../../hooks/useStudentExit'
import { formatDate, formatMoney, getApiErrorMessage } from './profileUtils'
import { LeavingConflictNotice } from './StatusUpdateModal'

const STEPS = ['Details', 'Clearance', 'Review']
const money = (value) => `PKR ${formatMoney(value)}`
const today = () => new Date().toISOString().slice(0, 10)

const STATE_STYLES = {
  CLEAR: 'bg-green-100 text-green-800',
  OPEN: 'bg-red-100 text-red-800',
  WAIVED: 'bg-amber-100 text-amber-800',
  CARRIED: 'bg-blue-100 text-blue-800',
}
const STATE_LABELS = { CLEAR: 'Clear', OPEN: 'Open', WAIVED: 'Waived', CARRIED: 'Carried' }

// Withdraw or transfer a student: details, then a clearance checklist (fees, library
// books, gate passes) where open items are cleared or waived with a reason, then a
// review and finalize. Closing it keeps the case open so work can resume later.
// Mount only while open.
export default function StudentExitWizard(props) {
  // The starting step depends on whether an exit is already open, so wait for it.
  const { isLoading } = useStudentExit(props.student.id)
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl px-6 py-4 text-sm text-gray-600" role="status">Loading…</div>
      </div>
    )
  }
  return <WizardBody {...props} />
}

function WizardBody({ student, prefill = null, onClose }) {
  const { showSuccess } = useToast()
  const exit = useStudentExit(student.id)
  const exitCase = exit.exitCase
  const { data: destinations = [] } = useExitDestinations(true)

  const [step, setStep] = useState(exitCase ? 1 : 0)
  const [form, setForm] = useState({
    exit_type: exitCase?.exit_type || prefill?.exit_type || 'WITHDRAWN',
    destination_school: exitCase?.destination_school ? String(exitCase.destination_school) : '',
    leaving_date: exitCase?.leaving_date || prefill?.leaving_date || today(),
    reason: exitCase?.reason || prefill?.reason || '',
    remove_records_after_leaving: exitCase?.remove_records_after_leaving || false,
    destination_session_class: exitCase?.destination_session_class ? String(exitCase.destination_session_class) : '',
    destination_roll_number: exitCase?.destination_roll_number || '',
  })
  const [rollTyped, setRollTyped] = useState(!!exitCase?.destination_roll_number)
  const [carrying, setCarrying] = useState(false) // the fee preview is open
  const [conflict, setConflict] = useState(null)
  const [error, setError] = useState('')
  const [waiving, setWaiving] = useState(null) // { kind, reason }
  const [cancelling, setCancelling] = useState(null) // reason text while the cancel box is open

  useEscapeKey(onClose, true)

  const isTransfer = form.exit_type === 'TRANSFERRED'
  const destinationName = destinations.find((s) => String(s.id) === form.destination_school)?.name
    || exitCase?.destination_school_name || 'the new branch'
  const { data: destinationClasses, isLoading: classesLoading, error: classesError } = useDestinationClasses(
    form.destination_school, form.leaving_date, isTransfer && step === 0,
  )
  const targetClass = destinationClasses?.classes?.find((c) => String(c.id) === form.destination_session_class)
  const occupiedRolls = useMemo(() => targetClass?.rolls || [], [targetClass])
  const autoFillRoll = useCallback((roll) => setForm((f) => ({ ...f, destination_roll_number: roll })), [])
  const { recommendedRoll } = useRollSuggestion({
    enabled: isTransfer,
    hasClass: !!targetClass,
    occupiedRolls,
    currentRoll: form.destination_roll_number,
    manuallyEdited: rollTyped,
    onAutoFill: autoFillRoll,
  })

  const set = (name, value) => {
    setForm((f) => ({
      ...f,
      [name]: value,
      // Another branch (or date, hence maybe another year) means another set of classes.
      ...(name === 'destination_school' || name === 'leaving_date'
        ? { destination_session_class: '', destination_roll_number: '' } : {}),
    }))
    if (name === 'destination_school' || name === 'leaving_date') setRollTyped(false)
    setConflict(null)
    setError('')
  }

  const items = exitCase?.items || []
  const openItems = items.filter((i) => i.state === 'OPEN')
  const busy = Object.values(exit).some((m) => m?.isPending)

  const run = async (action) => {
    setError('')
    try {
      return await action()
    } catch (err) {
      const data = err?.response?.data
      if (data?.code === 'records_after_leaving') setConflict(data)
      else setError(data?.detail || getApiErrorMessage(err, 'Something went wrong'))
      return null
    }
  }

  const detailsPayload = () => ({
    exit_type: form.exit_type,
    leaving_date: form.leaving_date,
    reason: form.reason,
    destination_school: form.exit_type === 'TRANSFERRED' && form.destination_school ? Number(form.destination_school) : null,
    remove_records_after_leaving: form.remove_records_after_leaving,
    ...(form.exit_type === 'TRANSFERRED' ? {
      destination_session_class: form.destination_session_class ? Number(form.destination_session_class) : null,
      destination_roll_number: form.destination_roll_number.trim(),
    } : {}),
  })

  const handleContinue = async () => {
    if (!form.leaving_date) {
      setError('A leaving date is required.')
      return
    }
    if (form.exit_type === 'TRANSFERRED' && !form.destination_school) {
      setError('Choose the branch the student is transferring to.')
      return
    }
    if (form.exit_type === 'TRANSFERRED' && !form.destination_session_class) {
      setError('Choose the class the student will join at the new branch.')
      return
    }
    if (form.exit_type === 'TRANSFERRED' && !form.destination_roll_number.trim()) {
      setError('Choose a roll number at the new branch.')
      return
    }
    const result = await run(() => (
      exitCase
        ? exit.update.mutateAsync({ id: exitCase.id, data: detailsPayload() })
        : exit.start.mutateAsync(detailsPayload())
    ))
    if (result) setStep(1)
  }

  const handleCarry = async () => {
    const result = await run(() => exit.carry.mutateAsync({ id: exitCase.id, kind: 'FEES' }))
    if (result) setCarrying(false)
  }

  const handleWaive = async () => {
    const result = await run(() => exit.waive.mutateAsync({ id: exitCase.id, kind: waiving.kind, reason: waiving.reason }))
    if (result) setWaiving(null)
  }

  const handleFinalize = async () => {
    const result = await run(() => exit.finalize.mutateAsync(exitCase.id))
    if (result) {
      showSuccess(`${student.name} has been ${form.exit_type === 'TRANSFERRED' ? 'transferred' : 'withdrawn'}.`)
      onClose()
    }
  }

  const handleCancelExit = async () => {
    const result = await run(() => exit.cancel.mutateAsync({ id: exitCase.id, reason: cancelling }))
    if (result) {
      showSuccess('Exit cancelled. The student is unchanged.')
      onClose()
    }
  }

  const stepper = (
    <ol className="flex items-center gap-2 text-xs mb-4" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === step ? 'step' : undefined}
          className={`px-2.5 py-1 rounded-full border ${
            i === step ? 'bg-primary-600 text-white border-primary-600' : i < step ? 'bg-primary-50 text-primary-700 border-primary-200' : 'text-gray-500 border-gray-200'
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  )

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Student exit</h2>
          <p className="text-sm text-gray-500 mt-1">{student.name} · Roll #{student.roll_number} · {student.class_name}</p>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {stepper}
          {error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {step === 0 && (
            <>
              <fieldset className="space-y-2">
                <legend className="block text-sm font-medium text-gray-700 mb-1">What is happening?</legend>
                {[
                  ['WITHDRAWN', 'Withdrawn (left school)'],
                  ['TRANSFERRED', 'Transferred to another branch of this organization'],
                ].map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                    <input
                      type="radio" name="exit_type" value={value} checked={form.exit_type === value}
                      onChange={() => set('exit_type', value)}
                      disabled={!!exitCase}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>

              {form.exit_type === 'TRANSFERRED' && (
                <div>
                  <label htmlFor="exit-destination" className="block text-sm font-medium text-gray-700 mb-1">Transferring to</label>
                  <select
                    id="exit-destination" className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={form.destination_school} onChange={(e) => set('destination_school', e.target.value)}
                  >
                    <option value="">Select a branch</option>
                    {destinations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {destinations.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">No other active branch in your organization.</p>
                  )}
                </div>
              )}

              {isTransfer && form.destination_school && (
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <p className="text-sm font-medium text-gray-900">
                    At {destinationName}
                    {destinationClasses?.academic_year && (
                      <span className="font-normal text-gray-500"> · {destinationClasses.academic_year.name}</span>
                    )}
                  </p>
                  {classesError && (
                    <p role="alert" className="text-xs text-red-700">
                      {classesError?.response?.data?.detail || 'Could not load the classes of that branch.'}
                    </p>
                  )}
                  <div>
                    <label htmlFor="exit-dest-class" className="block text-sm font-medium text-gray-700 mb-1">Class at the new branch</label>
                    <select
                      id="exit-dest-class" className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      value={form.destination_session_class} disabled={classesLoading}
                      onChange={(e) => {
                        setRollTyped(false)
                        setForm((f) => ({ ...f, destination_session_class: e.target.value, destination_roll_number: '' }))
                        setError('')
                      }}
                    >
                      <option value="">Select a class</option>
                      {(destinationClasses?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="exit-dest-roll" className="block text-sm font-medium text-gray-700 mb-1">Roll number at the new branch</label>
                    <input
                      id="exit-dest-roll" className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      value={form.destination_roll_number}
                      onChange={(e) => {
                        setRollTyped(true)
                        setForm((f) => ({ ...f, destination_roll_number: e.target.value }))
                      }}
                    />
                    {recommendedRoll && (
                      <p className="text-xs text-gray-500 mt-1">Next free roll in that class: {recommendedRoll}</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    A new student record is created at {destinationName} from the leaving date. The record here stays.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="exit-date" className="block text-sm font-medium text-gray-700 mb-1">Leaving date</label>
                <input
                  id="exit-date" type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={form.leaving_date} onChange={(e) => set('leaving_date', e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">The first day the student is gone.</p>
              </div>

              {conflict && (
                <LeavingConflictNotice
                  conflict={conflict}
                  removeRecords={form.remove_records_after_leaving}
                  onToggleRemove={(checked) => setForm((f) => ({ ...f, remove_records_after_leaving: checked }))}
                  onUseSuggestedDate={() => {
                    setForm((f) => ({ ...f, leaving_date: conflict.suggested_leaving_date, remove_records_after_leaving: false }))
                    setConflict(null)
                  }}
                />
              )}

              <div>
                <label htmlFor="exit-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea
                  id="exit-reason" rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="Brief reason" value={form.reason} onChange={(e) => set('reason', e.target.value)}
                />
              </div>
            </>
          )}

          {step === 1 && exitCase && (
            <>
              <p className="text-sm text-gray-600">
                Every item must be clear, or waived with a reason, before you can finalize. Items clear themselves once the
                underlying problem is fixed; use Refresh to check again.
              </p>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.kind} className="border border-gray-200 rounded-lg p-3" data-testid={`item-${item.kind}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.kind_label}</p>
                        <p className="text-sm text-gray-600">{item.summary || 'Nothing outstanding'}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATE_STYLES[item.state]}`}>
                        {STATE_LABELS[item.state]}
                      </span>
                    </div>

                    <ItemDetail item={item} />

                    {item.state === 'WAIVED' && (
                      <div className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
                        <p>Waived by {item.waived_by_name} on {formatDate(item.waived_at)}: {item.waiver_reason}</p>
                        <button
                          type="button" disabled={busy} className="mt-1 font-medium text-amber-800 underline"
                          onClick={() => run(() => exit.unwaive.mutateAsync({ id: exitCase.id, kind: item.kind }))}
                        >
                          Undo waiver
                        </button>
                      </div>
                    )}

                    {item.state === 'CARRIED' && (
                      <div className="mt-2 text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded p-2">
                        <p>{item.waiver_reason} ({item.waived_by_name}, {formatDate(item.waived_at)}). It becomes {destinationName}&apos;s to collect.</p>
                        <button
                          type="button" disabled={busy} className="mt-1 font-medium text-blue-800 underline"
                          onClick={() => run(() => exit.unwaive.mutateAsync({ id: exitCase.id, kind: item.kind }))}
                        >
                          Undo
                        </button>
                      </div>
                    )}

                    {item.state === 'OPEN' && item.kind === 'FEES' && isTransfer && exitCase.fee_carry_plan && carrying && (
                      <CarryPreview plan={exitCase.fee_carry_plan} busy={busy} onConfirm={handleCarry} onCancel={() => setCarrying(false)} />
                    )}

                    {item.state === 'OPEN' && item.kind === 'FEES' && isTransfer && exitCase.fee_carry_plan && !carrying && !waiving && (
                      <button
                        type="button" className="mt-2 mr-4 text-sm font-medium text-blue-700 hover:text-blue-800"
                        onClick={() => setCarrying(true)}
                      >
                        Carry to {exitCase.fee_carry_plan.destination}…
                      </button>
                    )}

                    {item.state === 'OPEN' && !(carrying && item.kind === 'FEES') && (waiving?.kind === item.kind ? (
                      <div className="mt-2 space-y-2">
                        <label htmlFor={`waive-${item.kind}`} className="block text-xs font-medium text-gray-700">Reason for waiving (at least 10 characters)</label>
                        <textarea
                          id={`waive-${item.kind}`} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={waiving.reason} onChange={(e) => setWaiving({ kind: item.kind, reason: e.target.value })}
                        />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={handleWaive} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm disabled:opacity-50">
                            Confirm waiver
                          </button>
                          <button type="button" onClick={() => setWaiving(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button" className="mt-2 text-sm font-medium text-amber-700 hover:text-amber-800"
                        onClick={() => setWaiving({ kind: item.kind, reason: '' })}
                      >
                        Waive…
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 2 && exitCase && (
            <>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Row label="Type" value={exitCase.exit_type_label} />
                {exitCase.destination_school_name && <Row label="Transferring to" value={exitCase.destination_school_name} />}
                {exitCase.destination_class_label && (
                  <Row label="Class at the new branch" value={`${exitCase.destination_class_label} · Roll #${exitCase.destination_roll_number}`} />
                )}
                <Row label="Leaving date" value={formatDate(exitCase.leaving_date)} />
                <Row label="Reason" value={exitCase.reason || '—'} />
              </dl>
              {exitCase.remove_records_after_leaving && (
                <p className="text-sm text-red-700">Attendance and marks on or after the leaving date will be removed (a copy is kept in the audit log).</p>
              )}
              {items.some((i) => i.state === 'CARRIED') && (
                <div className="text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="font-medium text-blue-900">Fees carried to {exitCase.destination_school_name}</p>
                  <p className="mt-1 text-blue-900">
                    {items.find((i) => i.state === 'CARRIED')?.summary}. It is created there as unpaid and is no longer
                    counted here.
                  </p>
                </div>
              )}
              {items.some((i) => i.state === 'WAIVED') && (
                <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="font-medium text-amber-900">Waived items</p>
                  <ul className="list-disc pl-5 mt-1 text-amber-900">
                    {items.filter((i) => i.state === 'WAIVED').map((i) => (
                      <li key={i.kind}>{i.kind_label}: {i.summary} — {i.waiver_reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-sm text-gray-700">
                <p className="font-medium text-gray-900">When you finalize</p>
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>The student is marked {exitCase.exit_type === 'TRANSFERRED' ? 'Transferred' : 'Withdrawn'} and this year&apos;s enrollment is closed.</li>
                  {exitCase.exit_type === 'TRANSFERRED' && (
                    <li>A new student record is created at {exitCase.destination_school_name}, starting {formatDate(exitCase.leaving_date)}.</li>
                  )}
                  <li>Their hostel room is vacated and transport assignment ended.</li>
                  <li>Their own login at this school is switched off.</li>
                  <li>Parents keep read-only access to the history.</li>
                </ul>
              </div>
              {openItems.length > 0 && (
                <p role="alert" className="text-sm text-red-700">
                  {openItems.length} item{openItems.length === 1 ? ' is' : 's are'} still open. Go back and clear or waive {openItems.length === 1 ? 'it' : 'them'}.
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200">
          {cancelling !== null ? (
            <div className="space-y-2">
              <label htmlFor="exit-cancel-reason" className="block text-sm font-medium text-gray-700">Why is this exit being cancelled? (optional)</label>
              <input
                id="exit-cancel-reason" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={cancelling} onChange={(e) => setCancelling(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCancelling(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Keep exit</button>
                <button type="button" disabled={busy} onClick={handleCancelExit} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm disabled:opacity-50">Cancel exit</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div>
                {exitCase && (
                  <button type="button" onClick={() => setCancelling('')} className="text-sm text-red-600 hover:text-red-700">
                    Cancel this exit
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm">
                  {exitCase ? 'Close' : 'Cancel'}
                </button>
                {step > 0 && (
                  <button type="button" onClick={() => setStep(step - 1)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm">
                    Back
                  </button>
                )}
                {step === 1 && (
                  <button
                    type="button" disabled={busy} onClick={() => run(() => exit.refresh.mutateAsync(exitCase.id))}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
                  >
                    Refresh
                  </button>
                )}
                {step === 0 && (
                  <button
                    type="button" onClick={handleContinue} disabled={busy || (conflict && !form.remove_records_after_leaving)}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
                  >
                    {busy ? 'Saving...' : 'Continue'}
                  </button>
                )}
                {step === 1 && (
                  <button type="button" onClick={() => setStep(2)} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
                    Review
                  </button>
                )}
                {step === 2 && (
                  <button
                    type="button" onClick={handleFinalize} disabled={busy || openItems.length > 0}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    {exit.finalize.isPending ? 'Finalizing...' : 'Finalize exit'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// What the new branch will receive: yearly charges (only if something is pending) and
// one balance per monthly charge, in the new branch's terms.
function CarryPreview({ plan, busy, onConfirm, onCancel }) {
  const monthly = plan.lines.filter((l) => l.fee_type === 'MONTHLY')
  const yearly = plan.lines.filter((l) => l.fee_type !== 'MONTHLY')
  const group = (title, lines) => lines.length > 0 && (
    <div>
      <p className="text-xs font-medium text-gray-700">{title}</p>
      <ul className="text-xs text-gray-700 space-y-0.5 mt-0.5">
        {lines.map((l, i) => (
          <li key={i}>
            {l.label}: {money(l.balance)}
            {!l.category_exists && <span className="text-gray-500"> (new charge type at {plan.destination})</span>}
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="mt-2 space-y-2 border border-blue-200 bg-blue-50/50 rounded-lg p-3" data-testid="carry-preview">
      <p className="text-sm font-medium text-gray-900">What {plan.destination} will receive</p>
      {group('Yearly charges', yearly)}
      {group('Monthly fee (one balance per charge)', monthly)}
      <p className="text-sm text-gray-900">Total: <strong>{money(plan.total)}</strong></p>
      <p className="text-xs text-gray-600">
        It is created there as unpaid and stays with the student. {plan.destination} is responsible for collecting it, and
        it no longer counts here. Nothing is marked as paid.
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={onConfirm} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
          Carry to {plan.destination}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}

function ItemDetail({ item }) {
  const detail = item.detail || {}
  if (item.kind === 'FEES' && detail.items?.length) {
    return (
      <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
        {detail.items.map((row, i) => (
          <li key={i}>{row.label}{row.month ? ` (${row.month}/${row.year})` : ''}: {money(row.balance)}</li>
        ))}
      </ul>
    )
  }
  if (item.kind === 'LIBRARY' && detail.books?.length) {
    return (
      <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
        {detail.books.map((b) => <li key={b.id}>{b.title} — due {formatDate(b.due_date)}{b.status === 'OVERDUE' ? ' (overdue)' : ''}</li>)}
      </ul>
    )
  }
  if (item.kind === 'GATE_PASS' && detail.passes?.length) {
    return (
      <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
        {detail.passes.map((p) => <li key={p.id}>Out to {p.going_to} since {formatDate(p.departure_date)}</li>)}
      </ul>
    )
  }
  return null
}
