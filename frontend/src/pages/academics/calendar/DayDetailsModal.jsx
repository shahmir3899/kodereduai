import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import { ENTRY_TONE } from '../../../components/academic/academicTones'
import { formatDay } from '../../sessions/termDefaults'
import { weekdayLabel } from './calendarUtils'

export default function DayDetailsModal({ dateKey, info, examNames, coverage, isSchoolAdmin, onClose, onAdd, onEdit, onDelete }) {
  const entries = info?.entries || []

  return (
    <Modal open onClose={onClose} size="2xl" title={`${weekdayLabel(dateKey)}, ${formatDay(dateKey)}`}>
      <p className="-mt-2 mb-4 text-sm text-gray-600 dark:text-gray-300">{info?.is_off_day ? 'Marked OFF' : 'No OFF-day flag'}</p>

      {coverage && coverage.classes_expected > 0 && (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          Attendance: {coverage.classes_marked} of {coverage.classes_expected} classes recorded
          {coverage.state === 'missed' && <span className="ml-2 font-medium text-amber-600 dark:text-amber-300">none recorded</span>}
        </p>
      )}

      <div className="space-y-3">
        {entries.length === 0 && examNames.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No events or off-days are configured for this date.</p>
        ) : null}

        {entries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.name}</p>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                  {entry.entry_kind === 'OFF_DAY' ? 'OFF Day' : 'Event'}
                  {entry.off_day_type ? ` · ${entry.off_day_type.replace(/_/g, ' ')}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{formatDay(entry.start_date)} - {formatDay(entry.end_date)}</p>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{entry.scope === 'CLASS' ? 'Specific Classes' : 'Whole School'}</p>
                {entry.description && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{entry.description}</p>}
              </div>
              {isSchoolAdmin && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onEdit(entry)} className="text-xs text-primary-600 hover:text-primary-700">Edit</button>
                  <button type="button" onClick={() => onDelete(entry)} className="text-xs text-red-600 hover:text-red-700">Delete</button>
                </div>
              )}
            </div>
          </div>
        ))}

        {examNames.map((name) => (
          <div key={name} className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900/60 dark:bg-indigo-900/20">
            <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">{name}</p>
            <Badge colors={ENTRY_TONE.exam}>Exam period</Badge>
          </div>
        ))}
      </div>

      {isSchoolAdmin && (
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" onClick={onAdd}>Add Event / Off Day</Button>
        </div>
      )}
    </Modal>
  )
}
