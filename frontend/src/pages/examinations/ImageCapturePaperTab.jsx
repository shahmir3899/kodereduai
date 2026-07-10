import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
import Toast from '../../components/Toast'
import PaperStructureBuilder, { makeDefaultSection } from './PaperStructureBuilder'
import QuestionSlotEditor from './QuestionSlotEditor'

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

/** Maps one extracted section into a PaperStructureBuilder-shaped structure row. */
function mapExtractedSectionToRow(section, index) {
  const slotsShown = Number(section?.shown_count) || 0
  const slotsCounted = Number(section?.counted_count ?? slotsShown) || slotsShown
  return makeDefaultSection(index, {
    title: section?.title || `Q${index + 1}`,
    instruction: section?.instruction || '',
    question_type: section?.question_type_guess || 'SHORT',
    slots_shown: slotsShown,
    slots_counted: slotsCounted,
    marks_per_question: Number(section?.marks_per_question) || 0,
  })
}

/** Maps one extracted question into a QuestionSlotEditor-shaped draft question. */
function mapExtractedQuestionToDraft(question, sectionKey, index) {
  const options = question?.options
  return {
    local_id: `ocr_${sectionKey || 'unassigned'}_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

/** Builds the review-stage prefill (structure rows + slotted questions) from ai_extracted_json. */
function buildPrefillFromExtraction(aiExtractedJson) {
  const header = aiExtractedJson?.header || {}
  const sections = Array.isArray(aiExtractedJson?.sections) ? aiExtractedJson.sections : []

  const structureRows = []
  const questions = []
  sections.forEach((section, sectionIndex) => {
    const row = mapExtractedSectionToRow(section, sectionIndex)
    structureRows.push(row)
    ;(section?.questions || []).forEach((question, questionIndex) => {
      questions.push(mapExtractedQuestionToDraft(question, row.key, questionIndex))
    })
  })

  return { header, structureRows, questions }
}

/**
 * ImageCapturePaperTab - "Capture from image" source for wizard Step 3.
 * Upload-first: works standalone even before Steps 1-2 are complete. Uploads the
 * image, polls the PaperUpload until OCR finishes, then shows detected header/
 * structure/questions as editable SUGGESTIONS the user reviews before accepting.
 */
export default function ImageCapturePaperTab({ classId, subjectId, readOnly = false, onApplyPrefill }) {
  const [uploadedImage, setUploadedImage] = useState(null)
  const [uploadId, setUploadId] = useState(null)
  const [detectedHeader, setDetectedHeader] = useState(null)
  const [reviewStructure, setReviewStructure] = useState([])
  const [reviewDraft, setReviewDraft] = useState(REVIEW_DRAFT_DEFAULT)
  const [toast, setToast] = useState(null)
  const hasAppliedExtractionRef = useRef(false)

  // Upload mutation — defined at top level (never inside a handler).
  const uploadMutation = useMutation({
    mutationFn: ({ file, uploadClassId, uploadSubjectId }) =>
      questionPaperApi.uploadPaperImage(file, uploadClassId || null, uploadSubjectId || null),
    onSuccess: (response) => {
      setUploadId(response.data.id)
    },
    onError: (error) => {
      setToast({ type: 'error', message: error.response?.data?.detail || 'Error uploading image' })
    },
  })

  // Polling query — genuinely polls (unlike the old enabled:false/never-refetched query):
  // refetchInterval re-evaluates after every fetch and stops once the upload reaches a
  // terminal status.
  const { data: pollResponse } = useQuery({
    queryKey: ['paperUploadStatus', uploadId],
    queryFn: () => questionPaperApi.getPaperUpload(uploadId),
    enabled: !!uploadId,
    refetchInterval: (query) => {
      const uploadStatus = query.state.data?.data?.status
      return TERMINAL_STATUSES.includes(uploadStatus) ? false : POLL_INTERVAL_MS
    },
  })
  const uploadRecord = pollResponse?.data || null

  // Apply the OCR extraction into locally-editable review state exactly once per upload.
  useEffect(() => {
    if (uploadRecord?.status !== 'EXTRACTED') return
    if (hasAppliedExtractionRef.current) return
    hasAppliedExtractionRef.current = true

    const { header, structureRows, questions } = buildPrefillFromExtraction(uploadRecord.ai_extracted_json)
    setDetectedHeader(header)
    setReviewStructure(structureRows)
    setReviewDraft({
      paper_title: header.exam_title || '',
      instructions: '',
      total_marks: String(
        header.detected_total_marks ?? uploadRecord.ai_extracted_json?.computed_total_marks ?? '100',
      ),
      duration_minutes: String(parseDurationMinutesFromLabel(header.duration_label) ?? '60'),
      questions,
    })
  }, [uploadRecord])

  const handleReset = useCallback(() => {
    setUploadedImage(null)
    setUploadId(null)
    setDetectedHeader(null)
    setReviewStructure([])
    setReviewDraft(REVIEW_DRAFT_DEFAULT)
    hasAppliedExtractionRef.current = false
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
          setUploadedImage({ file: compressedFile, preview: URL.createObjectURL(file) })
          uploadMutation.mutate({ file: compressedFile, uploadClassId: classId, uploadSubjectId: subjectId })
        },
        error: () => {
          setToast({ type: 'error', message: 'Error compressing image' })
        },
      })
    })
  }, [classId, subjectId, uploadMutation])

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
    if (!uploadRecord?.id) return
    onApplyPrefill?.({
      uploadId: uploadRecord.id,
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
  const isProcessing = !!uploadId && !!uploadRecord && ['PENDING', 'PROCESSING'].includes(uploadRecord.status)
  const isExtracted = uploadRecord?.status === 'EXTRACTED'
  const isFailed = uploadRecord?.status === 'FAILED'

  return (
    <div className="space-y-6">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This paper is finalized and is opened in read-only mode.
        </div>
      )}

      {!readOnly && !uploadId && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input {...inputProps} />
          <div className="text-4xl mb-3">📸</div>
          <p className="text-lg font-medium text-gray-800">
            {isDragActive ? 'Drop your paper image here' : 'Upload Question Paper Image'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Drag & drop a clear photo of your handwritten exam paper, or click to browse
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Supports JPEG, PNG, WebP • Max 10 MB • Camera enabled on mobile
          </p>
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

      {isFailed && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center space-y-3">
          <p className="text-red-800 font-medium">OCR extraction failed.</p>
          <p className="text-sm text-red-700">{uploadRecord?.error_message || 'Please try again with a clearer photo.'}</p>
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      )}

      {isExtracted && (
        <div className="space-y-6">
          {uploadedImage && (
            <img
              src={uploadedImage.preview}
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
                  {detectedHeader?.detected_total_marks ?? uploadRecord?.ai_extracted_json?.computed_total_marks ?? 'Not detected'}
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

          {/* Detected structure — editable before accepting */}
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

          <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
            >
              Upload Different Image
            </button>
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
