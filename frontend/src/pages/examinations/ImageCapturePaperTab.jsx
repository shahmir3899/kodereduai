import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
// `Toast`'s default export is actually ToastProvider, not a single-toast display
// component -- importing it as a standalone <Toast type=... message=... /> (as this
// file used to) silently renders nothing, since ToastProvider ignores those props
// and manages its own separate internal toast list. useToast() is the pattern that
// actually works elsewhere in this app (e.g. QuestionPaperBuilderPage).
import { useToast } from '../../components/Toast'
import PaperStructureBuilder, { calculateAllocatedMarks, makeDefaultSection } from './PaperStructureBuilder'
import QuestionSlotEditor from './QuestionSlotEditor'
import { useAuth } from '../../contexts/AuthContext'
import { useDebounce } from '../../hooks/useDebounce'

const REVIEW_DRAFT_DEFAULT = {
  paper_title: '',
  instructions: '',
  total_marks: '100',
  duration_minutes: '60',
  questions: [],
}

const POLL_INTERVAL_MS = 2500
const TERMINAL_STATUSES = ['EXTRACTED', 'FAILED']

function parseDurationMinutesFromLabel(label) {
  if (!label) return null
  const text = String(label).toLowerCase()
  const match = text.match(/(\d+(\.\d+)?)/)
  if (!match) return null
  const value = parseFloat(match[1])
  if (Number.isNaN(value)) return null
  return Math.round(text.includes('hour') ? value * 60 : value)
}

/** Maps one extracted section into a PaperStructureBuilder-shaped structure row.
 * key/local_id are namespaced by pageNumber so accumulating rows across several
 * pages of one multi-page capture can never collide (Date.now()+random alone would
 * be astronomically unlikely to collide, but the page prefix also makes each row's
 * origin obvious when debugging a multi-page paper). */
function mapExtractedSectionToRow(section, index, pageNumber) {
  const slotsShown = Number(section?.shown_count) || 0
  const slotsCounted = Number(section?.counted_count ?? slotsShown) || slotsShown
  const key = `sec_p${pageNumber}_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  return makeDefaultSection(index, {
    key,
    title: section?.title || `Q${index + 1}`,
    instruction: section?.instruction || '',
    question_type: section?.question_type_guess || 'SHORT',
    slots_shown: slotsShown,
    slots_counted: slotsCounted,
    marks_per_question: Number(section?.marks_per_question) || 0,
  })
}

/** Maps one extracted question into a QuestionSlotEditor-shaped draft question. */
function mapExtractedQuestionToDraft(question, sectionKey, index, pageNumber) {
  const options = question?.options
  return {
    local_id: `ocr_p${pageNumber}_${sectionKey || 'unassigned'}_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    question_id: null,
    section_key: sectionKey || '',
    question_text: question?.question_text || '',
    question_type: question?.question_type || 'SHORT',
    difficulty_level: 'MEDIUM',
    bloom_level: '',
    marks: Number(question?.marks) || 1,
    marks_override: Number(question?.marks) || 1,
    correct_answer: '',
    answer_text: '',
    type_data: question?.type_data && typeof question.type_data === 'object' ? question.type_data : {},
    options: {
      A: options?.A || '',
      B: options?.B || '',
      C: options?.C || '',
      D: options?.D || '',
    },
  }
}

/** Builds one page's prefill (structure rows + slotted questions) from its
 * ai_extracted_json, with keys namespaced to this pageNumber (see mappers above). */
function buildPrefillFromExtraction(aiExtractedJson, pageNumber) {
  const header = aiExtractedJson?.header || {}
  const sections = Array.isArray(aiExtractedJson?.sections) ? aiExtractedJson.sections : []

  const structureRows = []
  const questions = []
  sections.forEach((section, sectionIndex) => {
    const row = mapExtractedSectionToRow(section, sectionIndex, pageNumber)
    structureRows.push(row)
    ;(section?.questions || []).forEach((question, questionIndex) => {
      questions.push(mapExtractedQuestionToDraft(question, row.key, questionIndex, pageNumber))
    })
  })

  return { header, structureRows, questions }
}

const PAGE_STATUS_LABEL = {
  uploading: 'Uploading...',
  processing: 'Processing with OCR...',
  extracted: 'Extracted',
  failed: 'Failed',
}

/**
 * ImageCapturePaperTab - "Capture from image" source for wizard Step 3.
 * Upload-first: works standalone even before Steps 1-2 are complete. Supports a
 * multi-page paper captured strictly sequentially (upload page -> OCR -> review ->
 * "+ Add Page" -> next page ...), never in parallel — each page's OCR/LLM parse
 * call is independent, but page 2+ is nudged with a summary of what prior pages in
 * the same group already extracted (see backend tasks.py's continuation context),
 * so a section spanning a page break has a decent chance of being recognized as one.
 * Structure/questions from every reviewed page accumulate into one shared editable
 * draft (reviewStructure/reviewDraft) the user reviews before "Accept & continue".
 */
export default function ImageCapturePaperTab({ classId, subjectId, readOnly = false, onApplyPrefill }) {
  const { activeSchool, user } = useAuth()
  const { showError, showSuccess } = useToast()
  const [groupId, setGroupId] = useState(null)
  // One entry per page uploaded so far, in order: { pageNumber, uploadId, status,
  // questionCount, marksThisPage, errorMessage }. Drives the status strip; the
  // actual editable content lives in the flattened reviewStructure/reviewDraft below.
  const [pages, setPages] = useState([])
  const [activeUploadId, setActiveUploadId] = useState(null)
  const [uploadedImagePreview, setUploadedImagePreview] = useState(null)
  const [detectedHeader, setDetectedHeader] = useState(null)
  const [reviewStructure, setReviewStructure] = useState([])
  const [reviewDraft, setReviewDraft] = useState(REVIEW_DRAFT_DEFAULT)
  // True once the dropzone should be shown again to capture the next page (either
  // the very first page, or after "+ Add Page"). False while a page is mid
  // upload/processing or already extracted and awaiting the next action.
  const [awaitingUpload, setAwaitingUpload] = useState(true)
  const appliedUploadIdsRef = useRef(new Set())

  // Recovery: this whole multi-page capture used to live only in React memory, with
  // no protection against a page reload (a backend restart, a browser crash, or even
  // just clicking "Change source" and back -- ImageCapturePaperTab unmounts on every
  // tab switch) silently losing everything already captured. Mirrors the same
  // localStorage recovery pattern QuestionPaperBuilderPage already uses for the
  // manual-entry tab, scoped separately so the two don't collide.
  const recoveryKey = `paper_builder_image_capture_recovery_${activeSchool?.id || 'school'}_${user?.id || 'user'}`
  const hasRestoredImageRecoveryRef = useRef(false)

  useEffect(() => {
    if (hasRestoredImageRecoveryRef.current) return
    hasRestoredImageRecoveryRef.current = true
    if (readOnly) return

    try {
      const raw = localStorage.getItem(recoveryKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.pages) || parsed.pages.length === 0) return

      setGroupId(parsed.groupId || null)
      setPages(parsed.pages)
      setReviewStructure(Array.isArray(parsed.reviewStructure) ? parsed.reviewStructure : [])
      setReviewDraft(parsed.reviewDraft || REVIEW_DRAFT_DEFAULT)
      setDetectedHeader(parsed.detectedHeader || null)

      // A page still 'processing' when the reload happened -- resume polling it
      // instead of leaving it stuck with no active query forever.
      const inFlightPage = parsed.pages.find((page) => page.status === 'processing')
      appliedUploadIdsRef.current = new Set(
        parsed.pages.filter((page) => page.status !== 'processing').map((page) => page.uploadId),
      )
      if (inFlightPage) {
        setActiveUploadId(inFlightPage.uploadId)
      }
      setAwaitingUpload(!inFlightPage)
      showSuccess('Recovered your in-progress image capture from this browser.')
    } catch {
      // Ignore corrupt recovery payloads.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, recoveryKey])

  // Debounced save -- runs after every meaningful change so a mid-capture reload has
  // something recent to restore. Skipped once nothing has been captured yet (no
  // stale empty entry to clean up) and cleared entirely on accept/start-over below.
  const recoveryPayload = useDebounce({ groupId, pages, reviewStructure, reviewDraft, detectedHeader }, 500)
  useEffect(() => {
    if (readOnly) return
    if (!recoveryPayload.pages || recoveryPayload.pages.length === 0) {
      localStorage.removeItem(recoveryKey)
      return
    }
    try {
      localStorage.setItem(recoveryKey, JSON.stringify(recoveryPayload))
    } catch {
      // Recovery storage is best-effort (e.g. quota exceeded) -- never block capture.
    }
  }, [readOnly, recoveryKey, recoveryPayload])

  // Set by handleRetryFailedPage so the next upload reuses the failed page's own
  // number instead of the backend auto-incrementing past it (which would otherwise
  // leave a gap like Page 1, Page 3 in the status strip after a Page 2 retry).
  const retryPageNumberRef = useRef(null)

  // Upload mutation — defined at top level (never inside a handler).
  const uploadMutation = useMutation({
    mutationFn: ({ file, uploadClassId, uploadSubjectId, uploadGroupId, uploadPageNumber }) =>
      questionPaperApi.uploadPaperImage(file, uploadClassId || null, uploadSubjectId || null, uploadGroupId || undefined, uploadPageNumber || undefined),
    onSuccess: (response) => {
      const upload = response.data
      if (!groupId) setGroupId(upload.group_id)
      setActiveUploadId(upload.id)
      setAwaitingUpload(false)
      setPages((prev) => [
        ...prev,
        { pageNumber: upload.page_number, uploadId: upload.id, status: 'processing', questionCount: 0, marksThisPage: 0, errorMessage: '' },
      ])
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Error uploading image')
    },
  })

  // Polling query for whichever page is currently mid-processing — genuinely polls:
  // refetchInterval re-evaluates after every fetch and stops once that page reaches
  // a terminal status.
  const { data: pollResponse } = useQuery({
    queryKey: ['paperUploadStatus', activeUploadId],
    queryFn: () => questionPaperApi.getPaperUpload(activeUploadId),
    enabled: !!activeUploadId,
    refetchInterval: (query) => {
      const uploadStatus = query.state.data?.data?.status
      return TERMINAL_STATUSES.includes(uploadStatus) ? false : POLL_INTERVAL_MS
    },
  })
  const activeUploadRecord = pollResponse?.data || null

  // Apply the OCR extraction into the accumulated review state exactly once per
  // upload, then stop polling this page (activeUploadId cleared) so "+ Add Page"
  // can start the next one — pages are processed strictly one at a time, never in
  // parallel, by design.
  useEffect(() => {
    if (!activeUploadRecord) return
    if (appliedUploadIdsRef.current.has(activeUploadRecord.id)) return

    if (activeUploadRecord.status === 'FAILED') {
      appliedUploadIdsRef.current.add(activeUploadRecord.id)
      setPages((prev) => prev.map((page) => (
        page.uploadId === activeUploadRecord.id
          ? { ...page, status: 'failed', errorMessage: activeUploadRecord.error_message || 'Please try again with a clearer photo.' }
          : page
      )))
      setActiveUploadId(null)
      return
    }

    if (activeUploadRecord.status !== 'EXTRACTED') return
    appliedUploadIdsRef.current.add(activeUploadRecord.id)

    const pageNumber = activeUploadRecord.page_number
    const { header, structureRows, questions } = buildPrefillFromExtraction(activeUploadRecord.ai_extracted_json, pageNumber)
    const marksThisPage = calculateAllocatedMarks(structureRows)

    setReviewStructure((prev) => [...prev, ...structureRows])
    setReviewDraft((prev) => {
      const isFirstPage = pageNumber === 1
      return {
        ...prev,
        // Only the first page's header seeds paper_title/total_marks/duration —
        // later pages rarely repeat the header, and even when they do, the user's
        // own edits by then should win rather than being silently overwritten.
        paper_title: isFirstPage ? (header.exam_title || prev.paper_title) : prev.paper_title,
        total_marks: isFirstPage
          ? String(header.detected_total_marks ?? activeUploadRecord.ai_extracted_json?.computed_total_marks ?? prev.total_marks)
          : prev.total_marks,
        duration_minutes: isFirstPage
          ? String(parseDurationMinutesFromLabel(header.duration_label) ?? prev.duration_minutes)
          : prev.duration_minutes,
        questions: [...prev.questions, ...questions],
      }
    })
    if (pageNumber === 1) setDetectedHeader(header)

    setPages((prev) => prev.map((page) => (
      page.uploadId === activeUploadRecord.id
        ? { ...page, status: 'extracted', questionCount: questions.length, marksThisPage }
        : page
    )))
    setActiveUploadId(null)
  }, [activeUploadRecord])

  const handleStartOver = useCallback(() => {
    setGroupId(null)
    setPages([])
    setActiveUploadId(null)
    setUploadedImagePreview(null)
    setDetectedHeader(null)
    setReviewStructure([])
    setReviewDraft(REVIEW_DRAFT_DEFAULT)
    setAwaitingUpload(true)
    appliedUploadIdsRef.current = new Set()
    retryPageNumberRef.current = null
    localStorage.removeItem(recoveryKey)
  }, [recoveryKey])

  const handleRetryFailedPage = useCallback((failedPageNumber) => {
    setPages((prev) => prev.filter((page) => page.pageNumber !== failedPageNumber))
    retryPageNumberRef.current = failedPageNumber
    setAwaitingUpload(true)
  }, [])

  const onDrop = useCallback((acceptedFiles) => {
    const file = acceptedFiles[0]
    if (!file) return

    import('compressorjs').then(({ default: Compressor }) => {
      new Compressor(file, {
        quality: 0.8,
        maxWidth: 2000,
        maxHeight: 2000,
        mimeType: 'image/jpeg',
        success: (result) => {
          const compressedFile = new File([result], file.name, { type: 'image/jpeg' })
          setUploadedImagePreview(URL.createObjectURL(file))
          const uploadPageNumber = retryPageNumberRef.current
          retryPageNumberRef.current = null
          uploadMutation.mutate({ file: compressedFile, uploadClassId: classId, uploadSubjectId: subjectId, uploadGroupId: groupId, uploadPageNumber })
        },
        error: () => {
          showError('Error compressing image')
        },
      })
    })
  }, [classId, subjectId, groupId, uploadMutation])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    maxSize: 10 * 1024 * 1024,
    disabled: readOnly,
  })

  // Enhance input props to support camera capture on mobile
  const inputProps = {
    ...getInputProps(),
    capture: 'environment', // Opens rear camera on mobile devices
  }

  const handleAccept = () => {
    const extractedPages = pages.filter((page) => page.status === 'extracted')
    if (extractedPages.length === 0) return
    // Already handed off to the parent draft below -- nothing left here worth
    // recovering, and leaving it would wrongly "recover" an already-accepted
    // capture if this tab is ever revisited.
    localStorage.removeItem(recoveryKey)
    onApplyPrefill?.({
      // Kept for backward compatibility with anything still reading a single id;
      // uploadIds is the real list the feedback-confirm loop should use.
      uploadId: extractedPages[extractedPages.length - 1].uploadId,
      uploadIds: extractedPages.map((page) => page.uploadId),
      paperFields: {
        paper_title: reviewDraft.paper_title,
        total_marks: reviewDraft.total_marks,
        duration_minutes: reviewDraft.duration_minutes,
      },
      structure: reviewStructure,
      questions: reviewDraft.questions,
    })
  }

  const isUploading = uploadMutation.isPending
  const isProcessing = !!activeUploadId && !!activeUploadRecord && ['PENDING', 'PROCESSING'].includes(activeUploadRecord.status)
  const hasAnyExtractedPage = pages.some((page) => page.status === 'extracted')
  const currentPageFailed = pages.length > 0 && pages[pages.length - 1].status === 'failed'
  const showDropzone = !readOnly && awaitingUpload && !isUploading && !isProcessing

  // Non-blocking nudge: compare marks accumulated across all reviewed pages so far
  // against the detected/typed total. Renders nothing until we have both a real
  // total to compare against and at least one page reviewed.
  const detectedTotalMarks = Number(reviewDraft.total_marks) || null
  const capturedMarks = calculateAllocatedMarks(reviewStructure)
  const showMarksProgress = hasAnyExtractedPage && !!detectedTotalMarks

  // The dropzone / uploading-spinner / failed-panel for whichever page is currently
  // pending — rendered once, then placed either at the top (page 1) or inline near
  // "+ Add Page" at the bottom (page 2+). See the render-position comment above.
  const captureBlock = (
    <>
      {showDropzone && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 sm:p-12 text-center cursor-pointer transition ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input {...inputProps} />
          <div className="text-3xl sm:text-4xl mb-3">📸</div>
          <p className="text-base sm:text-lg font-medium text-gray-800">
            {isDragActive
              ? 'Drop your paper image here'
              : pages.length > 0
                ? `Upload Page ${pages.length + 1}`
                : 'Upload Question Paper Image'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Drag & drop a clear photo of your handwritten exam paper, or click to browse
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Supports JPEG, PNG, WebP • Max 10 MB • Camera enabled on mobile
          </p>
          {pages.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setAwaitingUpload(false) }}
              className="mt-4 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 underline"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {(isUploading || isProcessing) && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
          <p className="text-gray-600">
            {isUploading ? 'Compressing and uploading image...' : 'Processing with OCR... this can take up to a minute.'}
          </p>
        </div>
      )}

      {currentPageFailed && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center space-y-3">
          <p className="text-red-800 font-medium">OCR extraction failed.</p>
          <p className="text-sm text-red-700">{pages[pages.length - 1].errorMessage}</p>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-center">
            <button
              type="button"
              onClick={() => handleRetryFailedPage(pages[pages.length - 1].pageNumber)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Try This Page Again
            </button>
            {pages.length > 1 && (
              <button
                type="button"
                onClick={handleStartOver}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
              >
                Start Over
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This paper is finalized and is opened in read-only mode.
        </div>
      )}

      {/* Per-page status strip — visible once at least one page has been uploaded */}
      {pages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {pages.map((page) => (
            <span
              key={page.uploadId}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                page.status === 'extracted'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : page.status === 'failed'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              Page {page.pageNumber}
              {page.status === 'extracted' && ` ✓ ${page.questionCount} Qs`}
              {page.status !== 'extracted' && ` ${PAGE_STATUS_LABEL[page.status]}`}
            </span>
          ))}
        </div>
      )}

      {showMarksProgress && (
        <div
          className={`text-sm px-3 py-2 rounded-lg border ${
            capturedMarks < detectedTotalMarks
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : capturedMarks === detectedTotalMarks
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          {capturedMarks < detectedTotalMarks && (
            <>Captured {capturedMarks} / {detectedTotalMarks} marks across {pages.filter((p) => p.status === 'extracted').length} page(s) — this paper may be incomplete. Add another page, or Accept if this is really the whole paper.</>
          )}
          {capturedMarks === detectedTotalMarks && (
            <>{capturedMarks} / {detectedTotalMarks} marks captured — looks complete.</>
          )}
          {capturedMarks > detectedTotalMarks && (
            <>Captured {capturedMarks} / {detectedTotalMarks} marks — that's over the detected total; check the structure below for a duplicated or misallocated section.</>
          )}
        </div>
      )}

      {/* Until a page has actually been extracted, there's no review section below
          to scroll past, so this renders right here at the top (this also covers a
          page-1 upload failure, which happens before anything is "extracted"). Once
          at least one page is extracted, the identical block renders again inline
          near "+ Add Page" at the bottom instead (see captureBlock below) --
          otherwise clicking "+ Add Page" while looking at an already-long review
          section would show the dropzone up here, forcing a scroll back to the top
          just to browse for the next file. */}
      {!hasAnyExtractedPage && captureBlock}

      {hasAnyExtractedPage && (
        <div className="space-y-6">
          {uploadedImagePreview && (
            <img
              src={uploadedImagePreview}
              alt="Uploaded question paper"
              className="w-full max-w-xs mx-auto h-auto border border-gray-300 rounded-lg"
            />
          )}

          {/* Detected from image — display hints only, never auto-selected */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-3">Detected from image</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {detectedHeader?.school_name && (
                <div><span className="text-blue-700">School:</span> <span className="text-blue-900">{detectedHeader.school_name}</span></div>
              )}
              {detectedHeader?.exam_title && (
                <div><span className="text-blue-700">Exam title:</span> <span className="text-blue-900">{detectedHeader.exam_title}</span></div>
              )}
              <div>
                <span className="text-blue-700">Class:</span>{' '}
                <span className="text-blue-900">
                  {detectedHeader?.class_label
                    ? `Detected: ${detectedHeader.class_label} — select the matching class below`
                    : 'Not detected — select the class below'}
                </span>
              </div>
              <div>
                <span className="text-blue-700">Subject:</span>{' '}
                <span className="text-blue-900">
                  {detectedHeader?.subject_label
                    ? `Detected: ${detectedHeader.subject_label} — select the matching subject below`
                    : 'Not detected — select the subject below'}
                </span>
              </div>
              <div>
                <span className="text-blue-700">Total marks:</span>{' '}
                <span className="text-blue-900">
                  {detectedHeader?.detected_total_marks ?? 'Not detected'}
                </span>
              </div>
              {detectedHeader?.duration_label && (
                <div><span className="text-blue-700">Duration:</span> <span className="text-blue-900">{detectedHeader.duration_label}</span></div>
              )}
            </div>
            {!(classId && subjectId) && (
              <p className="text-xs text-blue-700 mt-3">
                Pick the actual class and subject in Paper Setup (Step 1) — detected labels are hints only.
              </p>
            )}
          </div>

          {/* Editable paper fields, prefilled from detection */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <h4 className="font-semibold text-gray-800">Paper Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Paper Title"
                value={reviewDraft.paper_title}
                onChange={(e) => setReviewDraft((prev) => ({ ...prev, paper_title: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Total Marks"
                value={reviewDraft.total_marks}
                onChange={(e) => setReviewDraft((prev) => ({ ...prev, total_marks: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Duration (minutes)"
                value={reviewDraft.duration_minutes}
                onChange={(e) => setReviewDraft((prev) => ({ ...prev, duration_minutes: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Detected structure — editable before accepting; accumulates across all
              reviewed pages so far (not just the page just extracted) */}
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">Detected Paper Structure</h4>
            <PaperStructureBuilder
              sections={reviewStructure}
              onChange={setReviewStructure}
              totalMarks={reviewDraft.total_marks}
            />
          </div>

          {/* Detected questions, slotted into their sections — editable before accepting */}
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">Detected Questions</h4>
            <QuestionSlotEditor
              draftData={reviewDraft}
              onDraftDataChange={setReviewDraft}
              structure={reviewStructure}
              classId={classId}
              subjectId={subjectId}
              source="manual"
              hideFooter
            />
          </div>

          {/* Inline "add page" capture, right where the button that triggers it
              lives — not up at the top of the page, which would force a scroll past
              the whole review section above just to reach the dropzone. */}
          {(awaitingUpload || isUploading || isProcessing || currentPageFailed) && (
            <div className="pt-4 border-t border-gray-200">{captureBlock}</div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleStartOver}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
            >
              Start Over
            </button>
            {!readOnly && !awaitingUpload && !isUploading && !isProcessing && (
              <button
                type="button"
                onClick={() => setAwaitingUpload(true)}
                className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50"
              >
                + Add Page
              </button>
            )}
            <button
              type="button"
              onClick={handleAccept}
              className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700"
            >
              Accept & continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
