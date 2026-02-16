import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBackgroundTasks } from '../contexts/BackgroundTaskContext'
import { tasksApi } from '../services/api'
import { useToast } from '../components/Toast'

/**
 * Hook to submit a background task and optionally poll for its result.
 *
 * @param {Object} options
 * @param {Function} options.mutationFn - API call that returns { task_id, message }
 * @param {string}   options.taskType   - e.g. 'REPORT_GENERATION'
 * @param {string}   options.title      - Human-readable title for the task panel
 * @param {Function} [options.onSuccess]   - Called when task completes, receives result_data
 * @param {Function} [options.onSubmitted] - Called immediately when task is dispatched
 */
export function useBackgroundTask({ mutationFn, taskType, title, onSuccess, onSubmitted }) {
  const { addTask } = useBackgroundTasks()
  const { showSuccess, showError } = useToast()
  const [submittedTaskId, setSubmittedTaskId] = useState(null)
  const onSuccessFiredRef = useRef(false)

  // Reset the fired flag when a new task is submitted
  useEffect(() => {
    if (submittedTaskId) {
      onSuccessFiredRef.current = false
    }
  }, [submittedTaskId])

  const mutation = useMutation({
    mutationFn,
    onSuccess: (res) => {
      const { task_id, message } = res.data
      setSubmittedTaskId(task_id)
      addTask(task_id, title, taskType, onSuccess)
      showSuccess(message || `${title} started`)
      onSubmitted?.(task_id)
    },
    onError: (err) => {
      const msg = err.response?.data?.detail
        || err.response?.data?.error
        || `Failed to start ${title}`
      showError(msg)
    },
  })

  // Poll this specific task for the calling page (optional local tracking)
  const { data: taskStatusResponse } = useQuery({
    queryKey: ['backgroundTask', submittedTaskId],
    queryFn: () => tasksApi.getTask(submittedTaskId),
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      if (status === 'SUCCESS' || status === 'FAILED') return false
      return 3000
    },
    enabled: !!submittedTaskId,
  })

  const currentStatus = taskStatusResponse?.data || null

  return {
    trigger: mutation.mutate,
    triggerAsync: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    submittedTaskId,
    taskStatus: currentStatus,
    isComplete: currentStatus?.status === 'SUCCESS',
    isFailed: currentStatus?.status === 'FAILED',
    resultData: currentStatus?.result_data || null,
  }
}
