import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { worksheetApi, questionPaperApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import RichTextEditor from '../../components/RichTextEditor'
import QuestionBankPicker, { QUESTION_TYPES, toDraftQuestionFromBank } from './QuestionBankPicker'
import PaperStructureBuilder, { makeDefaultSection } from './PaperStructureBuilder'
import { useToast } from '../../components/Toast'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useDebounce } from '../../hooks/useDebounce'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

const QUESTION_TYPE_LABELS = QUESTION_TYPES.reduce((acc, type) => {
  acc[type.value] = type.label
  return acc
}, {})

const EMPTY_ITEM = {
  local_id: null,
  question_id: null,
  question_text: '',
  question_image_url: null,
  question_type: 'SHORT',
  marks_override: '',
  correct_answer: '',
  answer_text: '',
  type_data: {},
  options: { A: '', B: '', C: '', D: '' },
  section_key: '',
}

const POLL_INTERVAL_MS = 2500
const TERMINAL_UPLOAD_STATUSES = ['EXTRACTED', 'FAILED']

/** Maps one extracted question (from the shared OCR pipeline) into a manual-item
 * draft -- same shape ImageCapturePaperTab.mapExtractedQuestionToDraft uses for
 * exam papers, adapted to item_order/manual_items naming. */
function mapExtractedQuestionToItem(question, sectionKey, index) {
  const options = question?.options
  return {
    local_id: `ocr_${sectionKey || 'unassigned'}_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    question_id: null,
    section_key: sectionKey || '',
    question_text: question?.question_text || '',
    question_type: question?.question_type || 'SHORT',
    marks_override: '',
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

/** New-worksheet creation shell: pick class/subject, then ensure-draft and
 * redirect to the real builder at /academics/worksheets/:id. */
function NewWorksheetForm() {
  const navigate = useNavigate()
  const { showError } = useToast()
  const { activeAcademicYear } = useAcademicYear()
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [title, setTitle] = useState('')
  // ClassSelector's value is a session-class id when the school uses Session
  // Classes (see CLASS_SYSTEM_GUIDE.md) -- Worksheet.class_obj is Master-Class-only,
  // so it (and the subject lookup, which is also keyed by master class_obj)
  // both need the resolved master id, not the raw selector value. Worksheets
  // created before this fix always got an empty subject list because of this.
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const resolvedClassId = getResolvedMasterClassId(classId, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: subjectsLoading } = useClassSubjects(resolvedClassId)

  const createMutation = useMutation({
    mutationFn: () => worksheetApi.ensureDraft({
      class_obj: resolvedClassId,
      subject: subjectId || undefined,
      title: title.trim() || 'Untitled Worksheet',
      source: 'MANUAL',
    }),
    onSuccess: (res) => navigate(`/academics/worksheets/${res.data.id}`, { replace: true }),
    onError: (err) => showError(err.response?.data?.detail || 'Failed to create worksheet.'),
  })

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-16">
      <div className="bg-white border border-gray-200 rounded-lg p-6 w-full max-w-md space-y-4">
        <h1 className="text-xl font-bold text-gray-900">New Worksheet</h1>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fractions Practice Sheet"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
          <ClassSelector
            value={classId}
            onChange={(e) => { setClassId(e.target.value); setSubjectId('') }}
            className="input w-full"
            scope={getClassSelectorScope(activeAcademicYear?.id)}
            academicYearId={activeAcademicYear?.id}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject (optional)</label>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={!classId || subjectsLoading}
            className="input w-full"
          >
            <option value="">{!classId ? 'Select class first' : 'No specific subject'}</option>
            {classSubjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!classId || createMutation.isPending}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {createMutation.isPending ? 'Creating…' : 'Create Worksheet'}
        </button>
      </div>
    </div>
  )
}

function ScanTab({ worksheet, onItemsExtracted }) {
  const { showError, showSuccess } = useToast()
  const [upload, setUpload] = useState(null)
  const pollRef = useRef(null)

  const uploadMutation = useMutation({
    mutationFn: (file) => worksheetApi.uploadWorksheetImage(file, worksheet.class_obj, worksheet.subject),
    onSuccess: (res) => setUpload(res.data),
    onError: (err) => showError(err.response?.data?.detail || 'Failed to upload image.'),
  })

  useEffect(() => {
    if (!upload || TERMINAL_UPLOAD_STATUSES.includes(upload.status)) return
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await worksheetApi.getWorksheetUpload(upload.id)
        setUpload(data)
        if (TERMINAL_UPLOAD_STATUSES.includes(data.status)) {
          clearInterval(pollRef.current)
        }
      } catch {
        clearInterval(pollRef.current)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(pollRef.current)
  }, [upload])

  const handleImport = () => {
    const extracted = upload?.ai_extracted_json
    if (!extracted) return
    const items = []
    const sections = Array.isArray(extracted.sections) ? extracted.sections : []
    const structure = sections.map((section, index) => makeDefaultSection(index, {
      key: `sec_scan_${index}_${Date.now()}`,
      title: section?.title || `Q${index + 1}`,
      question_type: section?.question_type_guess || 'SHORT',
      slots_shown: Number(section?.shown_count) || 0,
      slots_counted: Number(section?.counted_count ?? section?.shown_count) || 0,
      marks_per_question: Number(section?.marks_per_question) || 0,
    }))
    const questions = Array.isArray(extracted.questions) ? extracted.questions : []
    questions.forEach((question, index) => {
      items.push(mapExtractedQuestionToItem(question, question?.section_key, index))
    })
    onItemsExtracted({ structure, items })
    showSuccess(`Imported ${items.length} question(s) from the scan.`)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Photograph or scan a printed worksheet -- AI extracts the questions so you can review and import them
        rather than retyping the whole sheet.
      </p>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => { if (e.target.files?.[0]) uploadMutation.mutate(e.target.files[0]) }}
        disabled={uploadMutation.isPending}
        className="text-sm"
      />
      {upload && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-2">
          <p className="text-sm text-gray-700">Status: <span className="font-medium">{upload.status}</span></p>
          {upload.status === 'FAILED' && (
            <p className="text-sm text-red-600">{upload.error_message || 'Extraction failed.'}</p>
          )}
          {upload.status === 'EXTRACTED' && (
            <>
              <p className="text-sm text-gray-600">
                Extracted {(upload.ai_extracted_json?.questions || []).length} question(s)
                {upload.extraction_confidence ? ` at ${upload.extraction_confidence}% confidence` : ''}.
              </p>
              <button
                type="button"
                onClick={handleImport}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700"
              >
                Import into worksheet
              </button>
            </>
          )}
          {['PENDING', 'PROCESSING'].includes(upload.status) && (
            <p className="text-sm text-gray-500">Extracting… this can take up to a minute.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function WorksheetBuilderPage() {
  const { worksheetId } = useParams()

  if (worksheetId === 'new') {
    return <NewWorksheetForm />
  }

  return <WorksheetBuilderInner worksheetId={worksheetId} />
}

function WorksheetBuilderInner({ worksheetId }) {
  const { showError } = useToast()
  const [activeTab, setActiveTab] = useState('structure')
  const [downloading, setDownloading] = useState(null)
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [draft, setDraft] = useState(null)
  const [currentItem, setCurrentItem] = useState(EMPTY_ITEM)
  const [items, setItems] = useState([])
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const hydratedRef = useRef(false)

  const { data, isLoading } = useQuery({
    queryKey: ['worksheet', worksheetId],
    queryFn: () => worksheetApi.getWorksheet(worksheetId),
  })

  const worksheet = data?.data

  // Hydrate local editable state once when the worksheet first loads -- afterwards
  // local state is the source of truth and autosave pushes it up, mirroring
  // QuestionPaperBuilderPage's manualDraft pattern.
  useEffect(() => {
    if (!worksheet || hydratedRef.current) return
    hydratedRef.current = true
    setDraft({
      title: worksheet.title || '',
      instructions: worksheet.instructions || '',
      structure: worksheet.structure || [],
      render_options: worksheet.render_options || {},
    })
    setItems((worksheet.items || []).map((item) => ({
      local_id: `existing_${item.id}`,
      question_id: item.question,
      question_text: item.question_text || '',
      question_image_url: item.question_image_url || null,
      question_type: item.question_type || 'SHORT',
      marks_override: item.marks_override ?? '',
      correct_answer: item.correct_answer || '',
      answer_text: item.answer_text || '',
      type_data: item.type_data || {},
      options: {
        A: item.option_a || '', B: item.option_b || '', C: item.option_c || '', D: item.option_d || '',
      },
      section_key: item.section_key || '',
    })))
  }, [worksheet])

  const debouncedDraft = useDebounce(draft, 800)
  const debouncedItems = useDebounce(items, 800)

  const autosaveMutation = useMutation({
    mutationFn: (payload) => worksheetApi.autosaveDraft(worksheetId, payload),
    onMutate: () => setSaveState('saving'),
    onSuccess: () => setSaveState('saved'),
    onError: (err) => {
      setSaveState('error')
      showError(err.response?.data?.detail || 'Failed to save.')
    },
  })

  const skipFirstAutosave = useRef(true)
  useEffect(() => {
    if (!debouncedDraft || worksheet?.status !== 'DRAFT') return
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false
      return
    }
    autosaveMutation.mutate({
      title: debouncedDraft.title,
      instructions: debouncedDraft.instructions,
      structure: debouncedDraft.structure,
      render_options: debouncedDraft.render_options,
      manual_items: debouncedItems.map((item, index) => ({
        question_id: item.question_id,
        item_order: index + 1,
        section_key: item.section_key || '',
        marks_override: item.marks_override === '' ? null : item.marks_override,
        question_text: item.question_text,
        question_type: item.question_type,
        correct_answer: item.correct_answer,
        answer_text: item.answer_text,
        type_data: item.type_data,
        option_a: item.options?.A || '',
        option_b: item.options?.B || '',
        option_c: item.options?.C || '',
        option_d: item.options?.D || '',
      })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDraft, debouncedItems])

  const sectionOptions = useMemo(() => [
    { key: '', title: 'Unassigned' },
    ...((draft?.structure || []).filter((s) => s.type !== 'divider').map((s) => ({ key: s.key, title: s.title }))),
  ], [draft?.structure])

  const buildQuestionCreatePayload = (item) => ({
    subject: worksheet?.subject || undefined,
    question_text: item.question_text,
    question_type: item.question_type,
    marks: Number(item.marks_override) || 0,
    correct_answer: item.correct_answer || '',
    answer_text: item.answer_text || '',
    type_data: item.type_data || {},
    ...(item.question_type === 'MCQ' ? {
      option_a: item.options?.A || '', option_b: item.options?.B || '',
      option_c: item.options?.C || '', option_d: item.options?.D || '',
    } : {}),
  })

  const ensureQuestionId = async () => {
    if (currentItem.question_id) return currentItem.question_id
    if (!worksheet?.subject) {
      throw new Error('This worksheet has no subject set -- pick one, or add the question without a diagram.')
    }
    const { data } = await questionPaperApi.createQuestion(buildQuestionCreatePayload(currentItem))
    setCurrentItem((prev) => ({ ...prev, question_id: data.id }))
    return data.id
  }

  const handleDiagramInsert = async (file) => {
    try {
      const questionId = await ensureQuestionId()
      const { data } = await questionPaperApi.uploadQuestionDiagram(questionId, 'question', file)
      setCurrentItem((prev) => ({ ...prev, question_image_url: data.question_image_url }))
    } catch (err) {
      showError(err?.response?.data?.error || err?.message || 'Failed to upload diagram.')
    }
  }

  const handleDiagramRemove = async () => {
    if (!currentItem.question_id) return
    try {
      await questionPaperApi.removeQuestionDiagram(currentItem.question_id, 'question')
      setCurrentItem((prev) => ({ ...prev, question_image_url: null }))
    } catch {
      showError('Failed to remove diagram.')
    }
  }

  const handleAddItem = () => {
    if (!currentItem.question_text.trim()) {
      showError('Question text is required.')
      return
    }
    setItems((prev) => [...prev, { ...currentItem, local_id: currentItem.local_id || `new_${Date.now()}_${Math.random()}` }])
    setCurrentItem(EMPTY_ITEM)
  }

  const handleRemoveItem = (localId) => {
    setItems((prev) => prev.filter((item) => item.local_id !== localId))
  }

  const handleAttachFromBank = (bankQuestions) => {
    setItems((prev) => [
      ...prev,
      ...bankQuestions.map((q) => ({ ...toDraftQuestionFromBank(q), section_key: '' })),
    ])
    setShowBankPicker(false)
  }

  const handleImportFromScan = ({ structure: scannedStructure, items: scannedItems }) => {
    setDraft((prev) => ({ ...prev, structure: [...(prev?.structure || []), ...scannedStructure] }))
    setItems((prev) => [...prev, ...scannedItems])
    setActiveTab('items')
  }

  const handleDownload = async (format) => {
    setDownloading(format)
    try {
      const isPdf = format === 'pdf'
      const res = isPdf ? await worksheetApi.generatePDF(worksheetId) : await worksheetApi.generateDOCX(worksheetId)
      const mimeType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const blob = new Blob([res.data], { type: mimeType })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${draft?.title || 'worksheet'}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      showError(err.response?.data?.detail || `Failed to generate ${format.toUpperCase()}.`)
    } finally {
      setDownloading(null)
    }
  }

  if (isLoading || !draft) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading worksheet…</div>
  }

  const isReadOnly = worksheet.status !== 'DRAFT'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex-1">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              disabled={isReadOnly}
              className="text-xl font-bold text-gray-900 border-none focus:ring-0 p-0 w-full"
            />
            <p className="text-xs text-gray-500 mt-0.5">
              {worksheet.class_name}{worksheet.subject_name ? ` • ${worksheet.subject_name}` : ''} •{' '}
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : worksheet.status}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => handleDownload('pdf')} disabled={downloading === 'pdf'}
              className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-100 disabled:opacity-50">
              {downloading === 'pdf' ? 'Generating…' : 'Download PDF'}
            </button>
            <button type="button" onClick={() => handleDownload('docx')} disabled={downloading === 'docx'}
              className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-100 disabled:opacity-50">
              {downloading === 'docx' ? 'Generating…' : 'Download DOCX'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
          <textarea
            value={draft.instructions}
            onChange={(e) => setDraft((prev) => ({ ...prev, instructions: e.target.value }))}
            disabled={isReadOnly}
            rows={3}
            placeholder="Enter general instructions for students..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="border-b border-gray-200 flex gap-4">
          {['structure', 'compose', 'bank', 'scan', 'items'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'structure' ? 'Sections' : tab === 'compose' ? 'Add Manually' : tab === 'bank' ? 'From Bank' : tab === 'scan' ? 'Scan Image' : `Items (${items.length})`}
            </button>
          ))}
        </div>

        {activeTab === 'structure' && (
          <PaperStructureBuilder
            sections={draft.structure}
            onChange={(next) => setDraft((prev) => ({ ...prev, structure: next }))}
            totalMarks={0}
            readOnly={isReadOnly}
          />
        )}

        {activeTab === 'compose' && !isReadOnly && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Question Type</label>
                <select
                  value={currentItem.question_type}
                  onChange={(e) => setCurrentItem((prev) => ({ ...prev, question_type: e.target.value }))}
                  className="input w-full"
                >
                  {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Section</label>
                <select
                  value={currentItem.section_key}
                  onChange={(e) => setCurrentItem((prev) => ({ ...prev, section_key: e.target.value }))}
                  className="input w-full"
                >
                  {sectionOptions.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Question</label>
              <RichTextEditor
                value={currentItem.question_text}
                onChange={(value) => setCurrentItem((prev) => ({ ...prev, question_text: value }))}
                placeholder="Type the question..."
                diagram={{
                  imageUrl: currentItem.question_image_url,
                  targetLabel: 'this question',
                  onInsert: handleDiagramInsert,
                  onRemove: currentItem.question_image_url ? handleDiagramRemove : undefined,
                }}
              />
            </div>

            {currentItem.question_type === 'MCQ' && (
              <div className="grid grid-cols-2 gap-3">
                {['A', 'B', 'C', 'D'].map((letter) => (
                  <div key={letter}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Option {letter}</label>
                    <input
                      type="text"
                      value={currentItem.options[letter]}
                      onChange={(e) => setCurrentItem((prev) => ({ ...prev, options: { ...prev.options, [letter]: e.target.value } }))}
                      className="input w-full"
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Marks (optional -- worksheets are usually ungraded)</label>
              <input
                type="number"
                value={currentItem.marks_override}
                onChange={(e) => setCurrentItem((prev) => ({ ...prev, marks_override: e.target.value }))}
                className="input w-32"
              />
            </div>

            <button
              type="button"
              onClick={handleAddItem}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              + Add to Worksheet
            </button>
          </div>
        )}

        {activeTab === 'bank' && !isReadOnly && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <button
              type="button"
              onClick={() => setShowBankPicker(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Browse Question Bank
            </button>
            <QuestionBankPicker
              open={showBankPicker}
              onClose={() => setShowBankPicker(false)}
              classId={worksheet.class_obj}
              subjectId={worksheet.subject}
              excludeQuestionIds={items.map((i) => i.question_id).filter(Boolean)}
              onAttach={handleAttachFromBank}
            />
          </div>
        )}

        {activeTab === 'scan' && !isReadOnly && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <ScanTab worksheet={worksheet} onItemsExtracted={handleImportFromScan} />
          </div>
        )}

        {activeTab === 'items' && (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {items.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No items yet -- add some manually, from the bank, or by scanning a sheet.</div>
            ) : items.map((item, index) => (
              <div key={item.local_id} className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-xs text-gray-400">{index + 1}. {QUESTION_TYPE_LABELS[item.question_type] || item.question_type}{item.section_key ? ` • ${sectionOptions.find((s) => s.key === item.section_key)?.title || item.section_key}` : ''}</p>
                  <div className="text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: item.question_text }} />
                </div>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.local_id)}
                    className="text-xs text-red-600 hover:underline flex-none"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
