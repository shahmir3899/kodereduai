import { useState } from 'react'
import { useBackgroundTasks } from '../contexts/BackgroundTaskContext'

const STATUS_CONFIG = {
  PENDING: { color: 'text-gray-500', bg: 'bg-gray-50', label: 'Pending' },
  IN_PROGRESS: { color: 'text-blue-600', bg: 'bg-blue-50', label: 'Running' },
  SUCCESS: { color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  FAILED: { color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
}

export function TaskDrawerButton() {
  const { activeCount, totalCount } = useBackgroundTasks()
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (totalCount === 0) return null

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="Background Tasks"
      >
        <svg
          className={`w-5 h-5 text-gray-600 ${activeCount > 0 ? 'animate-spin' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {activeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-500 rounded-full">
            {activeCount}
          </span>
        )}
      </button>

      {drawerOpen && <TaskDrawerPanel onClose={() => setDrawerOpen(false)} />}
    </>
  )
}

function TaskDrawerPanel({ onClose }) {
  const { tasks, dismissTask, dismissAll } = useBackgroundTasks()

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black bg-opacity-25" onClick={onClose} />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 z-50 h-full w-96 max-w-[90vw] bg-white shadow-xl flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Background Tasks</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={dismissAll}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear completed
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No tasks</p>
          ) : (
            tasks.map(task => (
              <TaskItem key={task.celery_task_id} task={task} onDismiss={dismissTask} />
            ))
          )}
        </div>
      </div>
    </>
  )
}

function TaskItem({ task, onDismiss }) {
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.PENDING
  const showProgress = (task.status === 'IN_PROGRESS' || task.status === 'PENDING') && task.progress_total > 0
  const percent = task.progress_percent

  return (
    <div className={`${config.bg} rounded-lg p-3 border border-gray-200`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <StatusIcon status={task.status} className={`w-5 h-5 mt-0.5 flex-shrink-0 ${config.color}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
            <p className={`text-xs ${config.color}`}>{config.label}</p>
          </div>
        </div>
        {(task.status === 'SUCCESS' || task.status === 'FAILED') && (
          <button
            onClick={() => onDismiss(task.celery_task_id)}
            className="text-gray-400 hover:text-gray-600 ml-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Progress bar */}
      {showProgress && percent >= 0 && (
        <div className="mt-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{task.progress_current} / {task.progress_total}</span>
            <span>{percent}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Indeterminate progress */}
      {showProgress && percent === -1 && (
        <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div className="bg-blue-500 h-1.5 rounded-full w-1/3 animate-pulse" />
        </div>
      )}

      {/* Error message */}
      {task.status === 'FAILED' && task.error_message && (
        <p className="mt-1 text-xs text-red-600 line-clamp-2">{task.error_message}</p>
      )}

      {/* Result summary */}
      {task.status === 'SUCCESS' && task.result_data?.message && (
        <p className="mt-1 text-xs text-green-700">{task.result_data.message}</p>
      )}

      {/* Download link for reports */}
      {task.status === 'SUCCESS' && task.result_data?.download_url && (
        <a
          href={`${import.meta.env.VITE_API_URL || ''}${task.result_data.download_url}`}
          className="mt-1 text-xs text-blue-600 hover:underline inline-block"
          target="_blank"
          rel="noopener noreferrer"
        >
          Download file
        </a>
      )}
    </div>
  )
}

function StatusIcon({ status, className }) {
  if (status === 'IN_PROGRESS') {
    return (
      <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
  }
  if (status === 'SUCCESS') {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    )
  }
  if (status === 'FAILED') {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    )
  }
  // PENDING
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
