import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../../services/api'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { NumberBox } from './BlockForm'
import TypePicker from './TypePicker'
import {
  applyStructure, blockHasContent, blockSpec, freshStructureRows, newId, structureFromBlocks, structureLists,
  structureTotal, isEarlyClass,
} from './blockDocument'

const inputClass = 'px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50'

function newRow(type, registry, rows) {
  const spec = blockSpec(registry, type)
  const same = [...rows].reverse().find((row) => row.type === type)
  const row = { key: newId(), type, marks: same ? same.marks : 5 }
  if (structureLists(spec).length) row.parts = same?.parts ?? 5
  return row
}

/**
 * Step 2 of the paper wizard: the paper's shape (which questions, how many parts, how many marks) before any
 * question is written. Applying it makes every question at once with empty parts, so the teacher only fills them
 * in, instead of "+ Add question" and retyping heading and marks each time (docs/PAPER_BUILDER_STRUCTURE_PLAN.md).
 */
export default function StructureEditor({ blocks, registry, kind = 'paper', paperId, classId, subjectId, className = '', readOnly, onApply, onSkip }) {
  const [rows, setRows] = useState(() => structureFromBlocks(blocks, registry))
  const [target, setTarget] = useState(() => structureTotal(structureFromBlocks(blocks, registry)) || '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState(null)
  const [source, setSource] = useState('')
  const [copyError, setCopyError] = useState('')
  const usedTypes = useMemo(() => rows.map((row) => row.type), [rows])
  const templates = registry?.structure_templates || []

  const { data: papersRes } = useQuery({
    queryKey: ['structurePapers', classId, subjectId],
    queryFn: () => questionPaperApi.getExamPapers({ class_obj: classId, subject: subjectId, page_size: 50 }),
    enabled: kind === 'paper' && !!classId && !!subjectId,
    staleTime: 60 * 1000,
  })
  const otherPapers = (papersRes?.data?.results || []).filter((paper) => String(paper.id) !== String(paperId))

  const total = structureTotal(rows)
  const goal = Number(target) || 0
  const setRow = (key, change) => setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)))
  const move = (index, delta) => setRows((prev) => {
    const next = [...prev]
    const to = index + delta
    if (to < 0 || to >= next.length) return prev
    ;[next[index], next[to]] = [next[to], next[index]]
    return next
  })

  // A template or another paper replaces what is here only when nothing typed would be lost; otherwise it is added.
  const takeRows = (incoming) => {
    const fresh = freshStructureRows(incoming)
    const typed = rows.some((row) => row.blockId)
    setRows((prev) => (typed ? [...prev, ...fresh] : fresh))
    if (!typed || !target) setTarget(structureTotal(typed ? [...rows, ...fresh] : fresh))
  }
  const copyFrom = async (id) => {
    setSource(id)
    if (!id) return
    try {
      const response = await questionPaperApi.getPaperDocument(id)
      takeRows(structureFromBlocks(response.data?.document?.blocks || [], registry))
    } catch {
      setCopyError('That paper could not be opened. Try again.')
    } finally {
      setSource('')
    }
  }

  const apply = (confirmed = false) => {
    const result = applyStructure(blocks, rows, registry, kind)
    const losing = result.removed.filter((block) => blockHasContent(block, registry))
    if (losing.length && !confirmed) {
      setPendingRemoval(losing.length)
      return
    }
    setPendingRemoval(null)
    onApply(result.blocks)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Structure of the {kind === 'worksheet' ? 'worksheet' : 'paper'}</h3>
          <p className="text-xs text-gray-500">Which questions, how many parts and marks. The questions are made at once; you fill them in next.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="structure-target" className="text-gray-700">Total marks</label>
          <input id="structure-target" type="number" min={0} value={target} onChange={(e) => setTarget(e.target.value)}
            disabled={readOnly} className={`${inputClass} w-20`} />
          <span role="status" className={goal && total !== goal ? 'text-amber-700' : 'text-gray-600'}>
            {goal ? (total === goal ? `${total} of ${goal}` : `${total} of ${goal}, ${goal > total ? `${goal - total} left` : `${total - goal} over`}`) : `${total} marks`}
          </span>
        </div>
      </div>

      {!readOnly && (templates.length > 0 || otherPapers.length > 0) && (
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">Start from:</span>
          {templates.map((template) => (
            <Button key={template.id} size="sm" variant="secondary" onClick={() => takeRows(template.rows)}>{template.label}</Button>
          ))}
          {otherPapers.length > 0 && (
            <select aria-label="Copy the structure of another paper" value={source} onChange={(e) => copyFrom(e.target.value)} className={inputClass}>
              <option value="">Copy from a paper…</option>
              {otherPapers.map((paper) => <option key={paper.id} value={paper.id}>{paper.paper_title || `Paper ${paper.id}`}</option>)}
            </select>
          )}
          {copyError && <span className="text-xs text-red-600">{copyError}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left w-10">Q</th>
              <th className="px-3 py-2 text-left">Question type</th>
              <th className="px-3 py-2 text-left">Parts</th>
              <th className="px-3 py-2 text-left">Settings</th>
              <th className="px-3 py-2 text-left">Marks</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const spec = blockSpec(registry, row.type)
              const [list] = structureLists(spec)
              const choices = (spec?.fields || []).filter((field) => field.kind === 'choice' && !field.optional)
              return (
                <tr key={row.key} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                  <td className="px-3 py-2">
                    <span className="text-gray-900">{spec?.label || row.type}</span>
                    {row.blockId && <span className="ml-2 text-xs text-gray-400">in the paper</span>}
                  </td>
                  <td className="px-3 py-2">
                    {list ? (
                      <NumberBox value={row.parts} onCommit={(value) => setRow(row.key, { parts: value })}
                        limits={{ min: 0, max: list.max ?? 60, integer: true, fallback: 1 }}
                        readOnly={readOnly} className={`${inputClass} w-16`} ariaLabel={`Question ${index + 1} parts`} />
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {choices.map((field) => (
                      <select key={field.name} aria-label={`Question ${index + 1} ${field.label}`} disabled={readOnly}
                        value={row.data?.[field.name] ?? field.default ?? field.choices[0]}
                        onChange={(e) => setRow(row.key, { data: { ...(row.data || {}), [field.name]: e.target.value } })}
                        className={`${inputClass} mr-1`}>
                        {field.choices.map((choice) => <option key={choice} value={choice}>{field.labels?.[choice] ?? choice}</option>)}
                      </select>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    <NumberBox value={row.marks} onCommit={(value) => setRow(row.key, { marks: value })}
                      limits={{ min: 0, max: 1000, integer: false, fallback: 0 }}
                      readOnly={readOnly} className={`${inputClass} w-20`} ariaLabel={`Question ${index + 1} marks`} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {!readOnly && (
                      <>
                        <button type="button" aria-label="Move up" onClick={() => move(index, -1)} disabled={index === 0} className="px-1.5 text-gray-500 disabled:opacity-30">↑</button>
                        <button type="button" aria-label="Move down" onClick={() => move(index, 1)} disabled={index === rows.length - 1} className="px-1.5 text-gray-500 disabled:opacity-30">↓</button>
                        <button type="button" aria-label={`Remove question ${index + 1}`} onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))} className="px-1.5 text-red-600">Remove</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No questions yet. Add a row, or start from a template or another paper.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-2 justify-between">
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>+ Add questions</Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onSkip}>Skip, add questions one by one</Button>
            <Button size="sm" onClick={() => apply()} disabled={rows.length === 0 && blocks.length === 0}>Make the questions</Button>
          </div>
        </div>
      )}

      <TypePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        registry={registry}
        early={isEarlyClass(className)}
        used={usedTypes}
        layout={false}
        multiple
        onAddMany={(picked) => setRows((prev) => picked.reduce((list, { type, count }) => {
          let next = list
          for (let i = 0; i < count; i += 1) next = [...next, newRow(type, registry, next)]
          return next
        }, prev))}
      />

      {pendingRemoval && (
        <Modal open onClose={() => setPendingRemoval(null)} title="Remove questions?" size="sm"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setPendingRemoval(null)}>Keep them</Button>
              <Button variant="danger" onClick={() => apply(true)}>Remove</Button>
            </>
          )}>
          <p className="text-sm text-gray-700">
            {pendingRemoval === 1 ? 'One question you already wrote is' : `${pendingRemoval} questions you already wrote are`} not in the structure any more and will be removed from the paper.
          </p>
        </Modal>
      )}
    </div>
  )
}
