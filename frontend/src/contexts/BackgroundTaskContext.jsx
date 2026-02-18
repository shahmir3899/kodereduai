import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '../services/api'
import { useToast } from '../components/Toast'

const BackgroundTaskContext = createContext(null)

export function useBackgroundTasks() {
  const context = useContext(BackgroundTaskContext)
  if (!context) {
    throw new Error('useBackgroundTasks must be used within BackgroundTaskProvider')
  }
  return context
}

const QUERY_INVALIDATION_MAP = {
  REPORT_GENERATION: [['reports']],
  PAYSLIP_GENERATION: [['hrPayslips'], ['hrPayrollSummary'], ['hrDashboardStats']],
  TIMETABLE_GENERATION: [['timetableEntries'], ['timetableByClass']],
  FEE_GENERATION: [['feePayments'], ['monthlySummary']],
  BULK_PROMOTION: [['enrollments'], ['enrollmentsByClass']],
  PROMOTION_ADVISOR: [['promotionAdvisor']],
  FACE_ATTENDANCE: [['faceSessions'], ['pendingFaceReviews'], ['faceEnrollments']],
}

export function BackgroundTaskProvider({ children }) {
  const [trackedTaskIds, setTrackedTaskIds] = useState([])
  const [dismissedTaskIds, setDismissedTaskIds] = useState([])
  const previousStatusRef = useRef({})
  const completionCallbacksRef = useRef({})
  const queryClient = useQueryClient()
  const { showSuccess, showError } = useToast()

  const hasTrackedTasks = trackedTaskIds.length > 0

  const { data: tasksResponse } = useQuery({
    queryKey: ['backgroundTasks'],
    queryFn: () => tasksApi.getMyTasks(),
    refetchInterval: (query) => {
      const raw = query.state.data?.data
      const tasks = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : []
      const hasActive = tasks.some(
        t => t.status === 'PENDING' || t.status === 'IN_PROGRESS'
      )
      return hasActive ? 3000 : false
    },
    enabled: hasTrackedTasks,
  })

  const allTasksRaw = tasksResponse?.data
  const allTasks = Array.isArray(allTasksRaw) ? allTasksRaw : Array.isArray(allTasksRaw?.results) ? allTasksRaw.results : []

  const visibleTasks = allTasks.filter(
    t => trackedTaskIds.includes(t.celery_task_id) &&
         !dismissedTaskIds.includes(t.celery_task_id)
  )

  const activeTasks = visibleTasks.filter(
    t => t.status === 'PENDING' || t.status === 'IN_PROGRESS'
  )

  // Detect task completion and fire toasts + callbacks
  useEffect(() => {
    for (const task of allTasks) {
      if (!trackedTaskIds.includes(task.celery_task_id)) continue

      const prev = previousStatusRef.current[task.celery_task_id]
      if (prev && (prev === 'PENDING' || prev === 'IN_PROGRESS')) {
        if (task.status === 'SUCCESS') {
          showSuccess(`${task.title} completed!`)
          // Invalidate relevant queries
          const keys = QUERY_INVALIDATION_MAP[task.task_type] || []
          keys.forEach(key => queryClient.invalidateQueries({ queryKey: key }))
          // Fire completion callback if registered
          const cb = completionCallbacksRef.current[task.celery_task_id]
          if (cb) {
            cb(task.result_data)
            delete completionCallbacksRef.current[task.celery_task_id]
          }
        } else if (task.status === 'FAILED') {
          showError(`${task.title} failed: ${task.error_message || 'Unknown error'}`)
        }
      }
      previousStatusRef.current[task.celery_task_id] = task.status
    }
  }, [allTasks, trackedTaskIds, showSuccess, showError, queryClient])

  const addTask = useCallback((taskId, title, taskType, onComplete) => {
    setTrackedTaskIds(prev => [...prev, taskId])
    previousStatusRef.current[taskId] = 'PENDING'
    if (onComplete) {
      completionCallbacksRef.current[taskId] = onComplete
    }
    queryClient.invalidateQueries({ queryKey: ['backgroundTasks'] })
  }, [queryClient])

  const dismissTask = useCallback((taskId) => {
    setDismissedTaskIds(prev => [...prev, taskId])
  }, [])

  const dismissAll = useCallback(() => {
    const completedIds = visibleTasks
      .filter(t => t.status === 'SUCCESS' || t.status === 'FAILED')
      .map(t => t.celery_task_id)
    setDismissedTaskIds(prev => [...prev, ...completedIds])
  }, [visibleTasks])

  return (
    <BackgroundTaskContext.Provider value={{
      tasks: visibleTasks,
      activeTasks,
      addTask,
      dismissTask,
      dismissAll,
      activeCount: activeTasks.length,
      totalCount: visibleTasks.length,
    }}>
      {children}
    </BackgroundTaskContext.Provider>
  )
}
