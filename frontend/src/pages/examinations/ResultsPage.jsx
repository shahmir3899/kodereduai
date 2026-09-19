import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'

const formatDuration = (seconds) => (
  seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds)} s`
)

// Windows-copy style bar: real progress from the server, the fill glides between updates.
function CommentProgressBar({ job, onCancel, cancelling }) {
  const { current = 0, total = 0, elapsed_seconds: elapsed = 0, cancel_requested: stopping } = job
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0
  const eta = current > 0 && total > current ? (elapsed / current) * (total - current) : null
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 text-xs text-indigo-900 mb-1">
        <span className="font-medium">
          {stopping ? 'Stopping after the current students...' : total === 0 ? 'Preparing...' : `Generating comments: ${current} of ${total} students`}
        </span>
        <span className="text-indigo-700">
          {total > 0 ? `${pct}%` : ''}{eta != null ? ` · about ${formatDuration(eta)} left` : ''}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-indigo-100 overflow-hidden">
        <div
          className={`h-full rounded-full bg-indigo-600 transition-[width] duration-1000 ease-linear ${total === 0 ? 'w-1/3 animate-pulse' : ''}`}
          style={total > 0 ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-indigo-600">
        <span>Elapsed {formatDuration(elapsed)}. Comments already written are kept if you stop.</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling || stopping}
          className="px-2 py-0.5 border border-indigo-300 rounded text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const SOURCE_LABELS = { AI: 'AI', FALLBACK: 'Template', EDITED: 'Edited' }
const SOURCE_STYLES = {
  AI: 'bg-indigo-100 text-indigo-700',
  FALLBACK: 'bg-gray-100 text-gray-600',
  EDITED: 'bg-emerald-100 text-emerald-700',
}

// One editable comment line (overall or per subject): view, edit in place, regenerate.
function CommentRow({ label, text, source, at, model, onSave, onRegenerate }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setEditing(false)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save. You may not have access to this class or subject.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-gray-700">{label}</span>
        {source && SOURCE_LABELS[source] && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SOURCE_STYLES[source]}`}>{SOURCE_LABELS[source]}</span>
        )}
        {text && !source && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="Written before comment sources were tracked, so it cannot be told whether it came from the AI or the template. Regenerate to get a labelled one.">Older</span>
        )}
        {text && at && (
          <span className="text-[10px] text-gray-400">
            {source === 'EDITED' ? 'edited' : 'generated'} {new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {source === 'AI' && model ? ` · ${model}` : ''}
          </span>
        )}
        {!editing && (
          <span className="ml-auto flex gap-3">
            <button type="button" disabled={busy} onClick={() => { setDraft(text || ''); setEditing(true) }} className="text-indigo-600 hover:underline disabled:opacity-50">
              {text ? 'Edit' : 'Write'}
            </button>
            <button type="button" disabled={busy} onClick={() => run(onRegenerate)} className="text-gray-500 hover:underline disabled:opacity-50">
              {busy ? 'Working...' : 'Regenerate'}
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-1">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            maxLength={800}
            className="input w-full text-xs"
          />
          <div className="flex gap-2 mt-1">
            <button type="button" disabled={busy} onClick={() => run(() => onSave(draft))} className="px-2 py-1 bg-indigo-600 text-white rounded disabled:opacity-50">Save</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          </div>
        </div>
      ) : (
        <p className={`mt-0.5 ${text ? 'text-gray-600 italic' : 'text-gray-400'}`}>{text || 'No comment yet.'}</p>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  )
}

// Overall + per-subject comments for one student in one exam.
function CommentsPanel({ examId, student, onChanged }) {
  const save = (subjectId) => async (comment) => {
    await examinationsApi.editComment(examId, { studentId: student.student_id, subjectId, comment })
    onChanged()
  }
  const regenerate = (subjectId) => async () => {
    await examinationsApi.regenerateComment(examId, { studentId: student.student_id, subjectId })
    onChanged()
  }
  return (
    <div className="space-y-2.5">
      <CommentRow
        label="Overall"
        text={student.overall_comment}
        source={student.overall_comment_source}
        at={student.overall_comment_at}
        model={student.overall_comment_model}
        onSave={save(null)}
        onRegenerate={regenerate(null)}
      />
      {student.marks?.filter(m => m.marks_obtained != null && !m.is_absent).map(m => (
        <CommentRow
          key={m.subject_id}
          label={m.subject_name}
          text={m.ai_comment}
          source={m.comment_source}
          at={m.comment_at}
          model={m.comment_model}
          onSave={save(m.subject_id)}
          onRegenerate={regenerate(m.subject_id)}
        />
      ))}
    </div>
  )
}

export default function ResultsPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const [selectedExamId, setSelectedExamId] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [expandedStudent, setExpandedStudent] = useState(null)
  const [commentMsg, setCommentMsg] = useState('')

  const { sessionClasses } = useSessionClasses(yearFilter)
  const classSelectorScope = getClassSelectorScope(yearFilter)
  const resolvedClassFilter = getResolvedMasterClassId(classFilter, yearFilter, sessionClasses)

  // Sync year filter with global session switcher
  useEffect(() => {
    if (activeAcademicYear?.id) {
      setYearFilter(String(activeAcademicYear.id))
    }
  }, [activeAcademicYear?.id])

  // Queries
  const { data: examsRes } = useQuery({
    queryKey: ['exams', yearFilter, classFilter, resolvedClassFilter],
    queryFn: () => examinationsApi.getExams({
      academic_year: yearFilter || undefined,
      class_obj: resolvedClassFilter || undefined,
    }),
  })

  const { data: resultsRes, isLoading: resultsLoading } = useQuery({
    queryKey: ['examResults', selectedExamId],
    queryFn: () => examinationsApi.getExamResults(selectedExamId),
    enabled: !!selectedExamId,
  })

  const {
    isTeacher,
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: yearFilter || undefined,
    selectedClass: classFilter,
    setSelectedClass: setClassFilter,
    autoSelectFirst: true,
    queryKey: 'myResultsClasses',
  })

  // AI comment generation
  const generateCommentsMut = useMutation({
    mutationFn: ({ examId, force }) => examinationsApi.generateComments(examId, force),
    onSuccess: (res) => queryClient.setQueryData(['commentJob', selectedExamId], res),
    onError: () => setCommentMsg('Failed to start comment generation.'),
  })
  const cancelJobMut = useMutation({
    mutationFn: () => examinationsApi.cancelCommentJob(selectedExamId),
    onSuccess: (res) => queryClient.setQueryData(['commentJob', selectedExamId], res),
  })

  // The run happens on the server in the background; this reattaches to it after a
  // page reload and follows it with one small request per second while it is active.
  const isActive = (status) => status === 'PENDING' || status === 'IN_PROGRESS'
  const { data: jobRes } = useQuery({
    queryKey: ['commentJob', selectedExamId],
    queryFn: () => examinationsApi.getCommentJob(selectedExamId),
    enabled: !!selectedExamId,
    refetchInterval: (query) => (isActive(query.state.data?.data?.status) ? 1000 : false),
  })
  const job = jobRes?.data
  const jobActive = isActive(job?.status)

  const prevJob = useRef({ id: null, active: false })
  useEffect(() => {
    if (!job) return
    const justFinished = prevJob.current.id === job.task_id && prevJob.current.active && !jobActive
    if (justFinished) {
      queryClient.invalidateQueries({ queryKey: ['examResults', selectedExamId] })
      if (job.status === 'FAILED') {
        setCommentMsg(job.error || 'Comment generation failed.')
      } else {
        const d = job.result || {}
        const written = (d.generated || 0) + (d.overall_generated || 0)
        const templated = (d.fallback_used || 0) + (d.overall_fallback || 0)
        const parts = []
        if (written === 0 && d.skipped > 0 && !d.cancelled) {
          parts.push(`Nothing new to write: all ${d.skipped} subject comments already exist. Use Regenerate All to rewrite them`)
        } else {
          parts.push(`${d.cancelled ? 'Stopped. Saved' : 'Wrote'} ${d.generated || 0} subject comments and ${d.overall_generated || 0} overall comments`)
          if (templated > 0) parts.push(`${templated} of them used the standard template because the AI reply failed or was rejected`)
          if (d.skipped > 0) parts.push(`${d.skipped} subject comments already existed and were kept`)
        }
        if (d.incomplete > 0) parts.push(`${d.incomplete} students skipped: marks incomplete`)
        setCommentMsg(`${parts.join('. ')}.`)
      }
    }
    prevJob.current = { id: job.task_id, active: jobActive }
  }, [job?.task_id, job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshResults = () => queryClient.invalidateQueries({ queryKey: ['examResults', selectedExamId] })

  const exams = examsRes?.data?.results || examsRes?.data || []
  const results = resultsRes?.data?.results || resultsRes?.data || []
  // The results endpoint only returns per-student rows, and its is_pass needs every
  // subject passed -- so a student with any subject not yet entered is "incomplete",
  // not failed. Summary cards are derived from the same rows for consistency.
  const getStatus = (r) => {
    if (r.marks?.some(m => m.marks_obtained == null && !m.is_absent)) return 'incomplete'
    return r.is_pass ? 'pass' : 'fail'
  }
  const summary = results.length > 0 ? (() => {
    const complete = results.filter(r => getStatus(r) !== 'incomplete')
    const withMarks = results.filter(r => r.total_obtained > 0)
    const toppers = results.filter(r => r.rank === 1)
    return {
      total_students: results.length,
      pass_count: complete.filter(r => getStatus(r) === 'pass').length,
      fail_count: complete.filter(r => getStatus(r) === 'fail').length,
      incomplete_count: results.length - complete.length,
      class_average: withMarks.length ? withMarks.reduce((s, r) => s + r.percentage, 0) / withMarks.length : null,
      toppers: toppers.map(t => t.student_name),
      topper_marks: toppers[0]?.total_obtained,
      topper_percentage: toppers[0]?.percentage,
    }
  })() : null
  const hasAnyComments = results?.results?.some(r => r.marks?.some(m => m.ai_comment)) ||
    results?.some?.(r => r.marks?.some(m => m.ai_comment))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exam Results</h1>
        <p className="text-sm text-gray-600">View ranked results with pass/fail analysis</p>
      </div>

      {/* Selection */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <ClassSelector
              value={classFilter}
              onChange={e => { setClassFilter(e.target.value); setSelectedExamId('') }}
              className="input w-full text-sm"
              showAllOption={showAllOption}
              scope={classSelectorScope}
              academicYearId={yearFilter || undefined}
              classes={teacherClassOptions || undefined}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Exam</label>
            <select value={selectedExamId} onChange={e => setSelectedExamId(e.target.value)} className="input w-full text-sm">
              <option value="">Select exam...</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* AI Comment Generation */}
      {selectedExamId && (
        <div className="card mb-4 bg-indigo-50/50 border border-indigo-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-indigo-900">AI Report Card Comments</h3>
              <p className="text-xs text-indigo-700 mt-0.5">
                Uses AI to generate personalized 2-3 sentence comments for each student's marks based on their score, grade, and attendance record. Comments can be viewed by expanding student rows.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => { setCommentMsg(''); generateCommentsMut.mutate({ examId: selectedExamId, force: false }) }}
                disabled={generateCommentsMut.isPending || jobActive}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
              >
                {generateCommentsMut.isPending || jobActive ? 'Generating...' : 'Generate Comments'}
              </button>
              <button
                onClick={() => { setCommentMsg(''); generateCommentsMut.mutate({ examId: selectedExamId, force: true }) }}
                disabled={generateCommentsMut.isPending || jobActive}
                className="px-3 py-1.5 text-xs text-indigo-700 border border-indigo-300 rounded-lg hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap"
                title="Regenerate all generated comments (comments you edited by hand are kept)"
              >
                Regenerate All
              </button>
            </div>
          </div>
          {jobActive && (
            <CommentProgressBar job={job} onCancel={() => cancelJobMut.mutate()} cancelling={cancelJobMut.isPending} />
          )}
          {commentMsg && (
            <p className="mt-2 text-xs text-indigo-800 bg-indigo-100 rounded px-2 py-1">{commentMsg}</p>
          )}
        </div>
      )}

      {!selectedExamId ? (
        <div className="card p-4 sm:p-6">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Step 1: Class */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              classFilter ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                classFilter ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'
              }`}>{classFilter ? '\u2713' : '1'}</span>
              Select Class
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            {/* Step 2: Exam */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              classFilter ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300' : 'bg-gray-100 text-gray-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                classFilter ? 'bg-blue-500 text-white' : 'bg-gray-300 text-white'
              }`}>2</span>
              Select Exam
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            {/* Step 3: View */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
              View Results
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            {!classFilter
              ? 'Start by selecting a class to filter available exams.'
              : 'Now pick an exam to view ranked results.'}
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
            <p className="text-xs text-blue-700">
              <span className="font-semibold">Tip:</span> Expand a student row to generate AI report card comments.
            </p>
          </div>
        </div>
      ) : resultsLoading ? (
        <div className="text-center py-12">
          <Spinner size="md" className="mx-auto" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="card text-center">
                <p className="text-2xl font-bold text-gray-900">{summary.total_students || 0}</p>
                <p className="text-xs text-gray-500">Total Students</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-green-600">{summary.pass_count || 0}</p>
                <p className="text-xs text-gray-500">Passed</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-red-600">{summary.fail_count || 0}</p>
                <p className="text-xs text-gray-500">Failed{summary.incomplete_count > 0 ? ` · ${summary.incomplete_count} incomplete` : ''}</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-blue-600">{summary.class_average ? `${Number(summary.class_average).toFixed(1)}%` : '—'}</p>
                <p className="text-xs text-gray-500">Class Average</p>
              </div>
            </div>
          )}

          {/* Topper & Subject stats */}
          {summary?.toppers?.length > 0 && (
            <div className="card mb-4 bg-yellow-50/50 border border-yellow-200">
              <div className="flex items-center gap-2">
                <span className="text-yellow-600 text-lg">&#9733;</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Class Topper{summary.toppers.length > 1 ? 's' : ''}: <strong>{summary.toppers.join(', ')}</strong>
                  </p>
                  <p className="text-xs text-gray-600">
                    Total: {summary.topper_marks} | Percentage: {Number(summary.topper_percentage).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Results Table */}
          {results.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No results data available for this exam.</div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-3 text-center w-12">Rank</th>
                      <th className="px-3 py-3 text-left">Student</th>
                      <th className="px-3 py-3 text-left">Roll No</th>
                      <th className="px-3 py-3 text-center">Marks</th>
                      <th className="px-3 py-3 text-center">Total</th>
                      <th className="px-3 py-3 text-center">%</th>
                      <th className="px-3 py-3 text-center">Grade</th>
                      <th className="px-3 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((r, idx) => {
                      const hasComments = !r.is_incomplete
                      const isExpanded = expandedStudent === r.student_id
                      return (
                        <React.Fragment key={idx}>
                          <tr
                            className={`hover:bg-gray-50 ${getStatus(r) === 'fail' ? 'bg-red-50/30' : ''} ${hasComments ? 'cursor-pointer' : ''}`}
                            onClick={() => hasComments && setExpandedStudent(isExpanded ? null : r.student_id)}
                          >
                            <td className="px-3 py-2 text-center">
                              {r.rank == null ? (
                                <span className="text-sm text-gray-400">—</span>
                              ) : r.rank <= 3 ? (
                                <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                                  r.rank === 1 ? 'bg-yellow-500' : r.rank === 2 ? 'bg-gray-400' : 'bg-amber-600'
                                }`}>{r.rank}</span>
                              ) : (
                                <span className="text-sm text-gray-500">{r.rank}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm font-medium text-gray-900">
                              {r.student_name}
                              {hasComments && (
                                <span className="ml-1 text-indigo-400 text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm font-mono text-gray-600">{r.roll_number}</td>
                            <td className="px-3 py-2 text-sm text-center font-medium">{r.total_obtained ?? '—'}</td>
                            <td className="px-3 py-2 text-sm text-center text-gray-500">{r.total_possible ?? '—'}</td>
                            <td className="px-3 py-2 text-sm text-center font-medium">
                              {r.percentage != null ? `${Number(r.percentage).toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.grade ? (
                                <Badge tone="info">{r.grade}</Badge>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {getStatus(r) === 'pass' ? (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Pass</span>
                              ) : getStatus(r) === 'fail' ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">Fail</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">Incomplete</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="bg-indigo-50/50 px-6 py-3">
                                <p className="text-[10px] font-medium text-indigo-600 uppercase mb-1.5">Comments</p>
                                <CommentsPanel examId={selectedExamId} student={r} onChanged={refreshResults} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                {results.map((r, idx) => {
                  const hasComments = !r.is_incomplete
                  const isExpanded = expandedStudent === r.student_id
                  return (
                    <div
                      key={idx}
                      className={`card ${getStatus(r) === 'fail' ? 'border-red-200 bg-red-50/30' : ''} ${hasComments ? 'cursor-pointer' : ''}`}
                      onClick={() => hasComments && setExpandedStudent(isExpanded ? null : r.student_id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {r.rank == null ? (
                            <span className="text-sm text-gray-400">—</span>
                          ) : r.rank <= 3 ? (
                            <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                              r.rank === 1 ? 'bg-yellow-500' : r.rank === 2 ? 'bg-gray-400' : 'bg-amber-600'
                            }`}>{r.rank}</span>
                          ) : (
                            <span className="text-sm text-gray-400">#{r.rank}</span>
                          )}
                          <div>
                            <p className="font-medium text-gray-900 text-sm">
                              {r.student_name}
                              {hasComments && <span className="ml-1 text-indigo-400 text-[10px]">{isExpanded ? '▲' : '▼'}</span>}
                            </p>
                            <p className="text-xs text-gray-500">Roll: {r.roll_number}</p>
                          </div>
                        </div>
                        {getStatus(r) === 'pass' ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Pass</span>
                        ) : getStatus(r) === 'fail' ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">Fail</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">Incomplete</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span>Marks: {r.total_obtained ?? '—'}/{r.total_possible ?? '—'}</span>
                        <span>{r.percentage != null ? `${Number(r.percentage).toFixed(1)}%` : ''}</span>
                        {r.grade && <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded text-xs">{r.grade}</span>}
                      </div>
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-indigo-100" onClick={e => e.stopPropagation()}>
                          <p className="text-[10px] font-medium text-indigo-600 uppercase mb-1">Comments</p>
                          <CommentsPanel examId={selectedExamId} student={r} onChanged={refreshResults} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
