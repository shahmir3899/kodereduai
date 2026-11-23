import { useCallback, useEffect, useRef, useState } from 'react'
import Field from '../../components/ui/Field'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { worksheetApi, questionPaperApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useToast } from '../../components/Toast'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useDebounce } from '../../hooks/useDebounce'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import BlockPaperEditor from './blocks/BlockPaperEditor'
import StatusBar from './blocks/StatusBar'

// Worksheets are built with the paper's block editor (Paper Builder v2 Phase 6b, user decision 2026-11-15):
// details here, blocks in BlockPaperEditor kind="worksheet". Old worksheets open converted to blocks.

const DETAILS_DELAY_MS = 800

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
  // both need the resolved master id, not the raw selector value.
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const resolvedClassId = getResolvedMasterClassId(classId, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: subjectsLoading } = useClassSubjects(resolvedClassId)

  const createMutation = useMutation({
    mutationFn: () => worksheetApi.ensureDraft({
      class_obj: resolvedClassId,
      subject: subjectId,
      title: title.trim() || 'Untitled Worksheet',
      source: 'MANUAL',
    }),
    onSuccess: (res) => navigate(`/academics/worksheets/${res.data.id}`, { replace: true }),
    onError: (err) => showError(err.response?.data?.detail || 'Failed to create worksheet.'),
  })

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-16">
      <div className="bg-white border border-gray-200 rounded-lg p-6 w-full max-w-md space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">New Worksheet</h1>
        <Field label="Title">
          <input
            type="text"
            dir="auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fractions Practice Sheet"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </Field>
        <div>
          <label className="label">Class</label>
          <ClassSelector
            value={classId}
            onChange={(e) => { setClassId(e.target.value); setSubjectId('') }}
            className="input w-full"
            scope={getClassSelectorScope(activeAcademicYear?.id)}
            academicYearId={activeAcademicYear?.id}
          />
        </div>
        {/* Required: every question on the worksheet is also kept in the question bank, under a subject. */}
        <Field label="Subject">
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={!classId || subjectsLoading}
            className="input w-full"
          >
            <option value="">{!classId ? 'Select class first' : 'Choose the subject'}</option>
            {classSubjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!classId || !subjectId || createMutation.isPending}
          className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
        >
          {createMutation.isPending ? 'Creating…' : 'Create Worksheet'}
        </button>
      </div>
    </div>
  )
}

const detailsOf = (worksheet) => ({
  title: worksheet.title || '',
  instructions: worksheet.instructions || '',
  subject: worksheet.subject || '',
})

function WorksheetBuilderInner({ worksheetId }) {
  const { showError, showSuccess } = useToast()
  const queryClient = useQueryClient()
  const [details, setDetails] = useState(null)
  const [detailsState, setDetailsState] = useState('saved') // saved | saving | error
  const savedKeyRef = useRef(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['worksheet', worksheetId],
    queryFn: () => worksheetApi.getWorksheet(worksheetId),
    refetchOnWindowFocus: false,
  })
  const worksheet = data?.data
  const { subjects: classSubjects } = useClassSubjects(worksheet?.class_obj)

  // Load the details once; afterwards what the teacher types is the source of truth.
  useEffect(() => {
    if (!worksheet || details) return
    const loaded = detailsOf(worksheet)
    savedKeyRef.current = JSON.stringify(loaded)
    setDetails(loaded)
  }, [worksheet, details])

  const readOnly = worksheet ? worksheet.status !== 'DRAFT' : true

  // The editor autosaves the blocks; this autosaves only the details (same split as the paper page).
  const debouncedDetails = useDebounce(details, DETAILS_DELAY_MS)
  useEffect(() => {
    if (!debouncedDetails || readOnly) return
    const key = JSON.stringify(debouncedDetails)
    if (key === savedKeyRef.current) return
    const payload = {
      title: debouncedDetails.title.trim() || 'Untitled Worksheet',
      instructions: debouncedDetails.instructions,
    }
    if (debouncedDetails.subject) payload.subject = Number(debouncedDetails.subject)
    setDetailsState('saving')
    worksheetApi.autosaveDraft(worksheetId, payload)
      .then(() => {
        const subjectChanged = String(debouncedDetails.subject || '') !== String(worksheet.subject || '')
        savedKeyRef.current = key
        setDetailsState('saved')
        // The header (instructions, subject) is printed from the worksheet, so refresh the preview's source.
        if (subjectChanged) queryClient.invalidateQueries({ queryKey: ['worksheet', worksheetId] })
        queryClient.invalidateQueries({ queryKey: ['worksheets'] })
      })
      .catch((err) => {
        setDetailsState('error')
        showError(err.response?.data?.detail || 'The worksheet details could not be saved.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDetails])

  // A photographed sheet added in the editor: record the scan feedback for each page (the blocks are
  // already in the editor, which saves them itself).
  const handleCapturedPaper = useCallback((prefill) => {
    const uploadIds = prefill.uploadIds || [prefill.uploadId]
    uploadIds.filter(Boolean).forEach((uploadId) => {
      questionPaperApi.confirmPaperUpload(uploadId, {
        worksheet_id: Number(worksheetId),
        confirmed_data: prefill.blocks ? { blocks: prefill.blocks } : { questions: prefill.questions || [] },
      }).catch(() => showError('Could not record the scan feedback (your worksheet is unaffected).'))
    })
  }, [showError, worksheetId])

  if (isError) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">The worksheet could not be opened.</div>
  }
  if (isLoading || !worksheet || !details) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading worksheet…</div>
  }

  const set = (name) => (e) => setDetails((prev) => ({ ...prev, [name]: e.target.value }))
  const stateLabel = readOnly
    ? `${worksheet.status.charAt(0)}${worksheet.status.slice(1).toLowerCase()} (read only)`
    : { saved: 'Details saved', saving: 'Saving details…', error: 'Details not saved' }[detailsState]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-[16rem]">
            <Link to="/academics/worksheets" className="text-xs text-blue-600 hover:underline">← Worksheets</Link>
            <input
              type="text"
              dir="auto"
              aria-label="Worksheet title"
              value={details.title}
              onChange={set('title')}
              disabled={readOnly}
              className="block text-xl font-bold text-gray-900 border-none focus:ring-0 p-0 w-full"
            />
            <p className="text-xs text-gray-500 mt-0.5">
              {worksheet.class_name}{worksheet.subject_name ? ` • ${worksheet.subject_name}` : ''} •{' '}
              <span className={detailsState === 'error' ? 'text-red-600' : ''} role="status">{stateLabel}</span>
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_16rem] gap-3">
          <label className="block text-sm text-gray-700">
            Instructions (printed under the header)
            <textarea
              dir="auto"
              value={details.instructions}
              onChange={set('instructions')}
              disabled={readOnly}
              rows={2}
              placeholder="e.g. Read each question carefully."
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </label>
          {!worksheet.subject && (
            <label className="block text-sm text-gray-700">
              Subject
              <select value={details.subject} onChange={set('subject')} disabled={readOnly}
                className="mt-1 w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Choose the subject</option>
                {classSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
              <span className="block mt-1 text-xs text-amber-700">Needed before you add questions: they are kept in the question bank under a subject.</span>
            </label>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-4">
        <StatusBar
          status={worksheet.status}
          save={(status) => worksheetApi.updateWorksheet(worksheetId, { status })}
          onChanged={(status) => {
            queryClient.invalidateQueries({ queryKey: ['worksheet', worksheetId] })
            queryClient.invalidateQueries({ queryKey: ['worksheetsList'] })
            showSuccess(status === 'DRAFT' ? 'The worksheet is a draft again: you can change it.' : `The worksheet is now ${status === 'READY' ? 'ready' : 'published'}.`)
          }}
          onError={showError}
        />
        <BlockPaperEditor
          kind="worksheet"
          paperId={Number(worksheetId)}
          paperTitle={details.title || worksheet.title}
          readOnly={readOnly}
          classId={worksheet.class_obj}
          subjectId={worksheet.subject}
          onCapturedPaper={handleCapturedPaper}
        />
      </div>
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
