import { useQuery } from '@tanstack/react-query'
import { admissionsApi } from '../services/api'

/**
 * useWorkflowTransition
 * 
 * Custom hook to manage workflow transition logic and data fetching.
 * Fetches the full workflow information and provides utilities for transitions.
 * 
 * Usage:
 * const {
 *   workflow,
 *   currentStageIndex,
 *   nextStages,
 *   isLoading,
 *   error,
 * } = useWorkflowTransition(enquiryId, sessionId)
 */
export function useWorkflowTransition(enquiryId, sessionId) {
  // Fetch workflow info for the enquiry
  const {
    data: workflowInfo,
    isLoading: workflowLoading,
    error: workflowError,
  } = useQuery({
    queryKey: ['workflow-info', enquiryId],
    queryFn: () => admissionsApi.getWorkflowInfo(enquiryId),
    enabled: !!enquiryId,
  })

  // Fetch session details for fee config
  const {
    data: sessionDetails,
    isLoading: sessionLoading,
    error: sessionError,
  } = useQuery({
    queryKey: ['session-details', sessionId],
    queryFn: () => admissionsApi.getSession(sessionId),
    enabled: !!sessionId,
  })

  // Find current stage index
  const currentStageIndex =
    workflowInfo?.workflow?.findIndex(
      (stage) => stage.status === 'CURRENT'
    ) ?? 0

  return {
    workflow: workflowInfo?.workflow || [],
    currentStage: workflowInfo?.current_stage || '',
    currentStageIndex,
    nextStages: workflowInfo?.next_stages || [],
    allowBypass: workflowInfo?.allow_bypass || false,
    requireFeeBeforeEnrollment:
      sessionDetails?.require_fee_before_enrollment || false,
    feePaidStatus: workflowInfo?.fee_paid || false,
    isLoading: workflowLoading || sessionLoading,
    error: workflowError || sessionError,
    workflowInfo,
    sessionDetails,
  }
}
