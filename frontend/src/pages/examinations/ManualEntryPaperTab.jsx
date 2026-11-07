import QuestionSlotEditor from './QuestionSlotEditor'

/**
 * ManualEntryPaperTab - the Step 3 slot board. Every slot can be written or filled from
 * the question bank, so there is no separate bank source any more; the lesson-plan
 * filter lives inside the bank picker (pass lessonPlanIds / onLessonPlanIdsChange).
 */
export default function ManualEntryPaperTab(props) {
  return <QuestionSlotEditor {...props} />
}
