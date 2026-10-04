import { useEffect, useMemo } from 'react'
import { getNextAvailableRoll } from '../utils/rollSuggestion'

// Next free roll number for a class, plus the "fill it in until the user types
// their own" behaviour that StudentsPage and StudentProfilePage each hand-rolled.
//
// occupiedRolls must exclude the student being edited, or their own roll counts
// as taken.
export function useRollSuggestion({
  enabled,
  hasClass,
  occupiedRolls,
  currentRoll,
  manuallyEdited,
  onAutoFill,
}) {
  // Keyed by content: callers build occupiedRolls with .map(), a fresh array every render.
  const occupiedKey = (occupiedRolls || []).join('|')

  const recommendedRoll = useMemo(
    () => (enabled && hasClass ? getNextAvailableRoll(occupiedRolls) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, hasClass, occupiedKey],
  )

  useEffect(() => {
    if (!recommendedRoll || manuallyEdited || String(currentRoll ?? '').trim()) return
    onAutoFill(recommendedRoll)
  }, [recommendedRoll, manuallyEdited, currentRoll, onAutoFill])

  return { recommendedRoll }
}
