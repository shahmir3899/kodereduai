import { useState } from 'react'
import LoadingState from '../../../components/ui/LoadingState'
import { TERM_COLOURS } from '../../../components/academic/academicTones'
import { formatDay } from '../../sessions/termDefaults'

/**
 * One panel in place of three stacked cards: the month's terms, entries and exam groups as tabs.
 */
export default function SidePanel({ terms, entries, entriesLoading, examGroups, isSchoolAdmin, onEdit, onDelete }) {
  const [tab, setTab] = useState('entries')
  const tabs = [
    { key: 'entries', label: 'Entries', count: entries.length },
    { key: 'terms', label: 'Terms', count: terms.length },
    { key: 'exams', label: 'Exams', count: examGroups.length },
  ]

  return (
    <div className="card p-0 sm:p-0 dark:bg-gray-800 dark:border-gray-700">
      <div role="tablist" aria-label="This month" className="flex border-b border-gray-200 dark:border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${tab === t.key ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
          >
            {t.label} <span className="ml-1 text-xs text-gray-400">{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" className="max-h-[420px] space-y-2 overflow-auto p-3 sm:p-4">
        {tab === 'entries' && (
          entriesLoading ? (
            <LoadingState label="Loading entries..." compact />
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No custom events or off days in selected month.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-2">
                    <span className="mt-0.5 h-8 w-1 shrink-0 rounded" style={{ backgroundColor: entry.color || '#0ea5e9' }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{entry.name}</p>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{formatDay(entry.start_date)} - {formatDay(entry.end_date)}</p>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{entry.scope === 'CLASS' ? 'Class Specific' : 'Whole School'}</p>
                    </div>
                  </div>
                  {isSchoolAdmin && (
                    <div className="flex shrink-0 gap-3">
                      <button onClick={() => onEdit(entry)} className="text-xs text-primary-600 hover:text-primary-700">Edit</button>
                      <button onClick={() => onDelete(entry)} className="text-xs text-red-600 hover:text-red-700">Delete</button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )
        )}

        {tab === 'terms' && (
          terms.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No term dates overlap this month.</p>
          ) : (
            terms.map(({ term, index }) => (
              <div key={term.id} className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 dark:border-primary-900/60 dark:bg-primary-900/20">
                <span className={`h-8 w-1 shrink-0 rounded ${TERM_COLOURS[index % TERM_COLOURS.length]}`} />
                <div>
                  <p className="text-sm font-medium text-primary-900 dark:text-primary-200">{term.name}</p>
                  <p className="text-xs text-primary-700 dark:text-primary-300">{formatDay(term.start_date)} - {formatDay(term.end_date)}</p>
                </div>
              </div>
            ))
          )
        )}

        {tab === 'exams' && (
          examGroups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No exam groups scheduled this month.</p>
          ) : (
            examGroups.map((g) => (
              <div key={g.id} className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900/60 dark:bg-indigo-900/20">
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">{g.name}</p>
                <p className="text-xs text-indigo-700 dark:text-indigo-300">{formatDay(g.start_date)} - {formatDay(g.end_date)}</p>
                {g.exam_type && <p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-300">{g.exam_type_name || g.exam_type?.name || ''}</p>}
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}
