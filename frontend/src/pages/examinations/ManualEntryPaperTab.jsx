import QuestionSlotEditor from './QuestionSlotEditor'

/**
 * ManualEntryPaperTab - "Type manually" source for wizard Step 3.
 * Thin wrapper around the shared QuestionSlotEditor engine (source="manual"):
 * free-typing composer + slots when a structure is defined, flat list otherwise.
 */
export default function ManualEntryPaperTab(props) {
  return <QuestionSlotEditor {...props} source="manual" />
}
