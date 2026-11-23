import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useDebounce } from '../../../hooks/useDebounce'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import LoadingState from '../../../components/ui/LoadingState'
import QuestionBankPicker from '../QuestionBankPicker'
import ImageCapturePaperTab from '../ImageCapturePaperTab'
import A4Preview from './A4Preview'
import StructureEditor from './StructureEditor'
import TypePicker from './TypePicker'
import BlockForm, { PaperDirectionContext } from './BlockForm'
import { downloadPaperWord, printAnswerKey, printPaper } from './printPaper'
import { documentApi, headerSwitchOn } from './documentApi'
import {
  bankAddedMessage,
  bankQuestionsToBlocks,
  blockSummary,
  capturedPaperToBlocks,
  documentMarks,
  duplicateBlock,
  isLostActivity,
  isQuestionBlock,
  mergeSavedIds,
  moveBlock,
  newBlockFor,
  problemsByQuestion,
  questionNumbers,
  isEarlyClass,
  stillToFill,
  withItemKeys,
} from './blockDocument'

const SAVE_DELAY_MS = 1200
const PREVIEW_DELAY_MS = 700

function formatMarks(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/** The "still to fill" list from a refused print, Word or answer key (Word answers come back as a blob). */
async function stillToFillFromError(error) {
  let data = error?.response?.data
  if (data && typeof data.text === 'function') {
    try { data = await data.text() } catch { return null }
  }
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return null }
  }
  const list = Array.isArray(data?.document) ? data.document : null
  return list && list.some((line) => String(line).startsWith('Still to fill')) ? list : null
}

function problemsFromError(error) {
  const data = error?.response?.data
  if (typeof data === 'string') {
    try { return JSON.parse(data)?.document || null } catch { return null }
  }
  return Array.isArray(data?.document) ? data.document : null
}

/**
 * Step 2 of the Question Paper Builder: the whole paper as blocks. Outline on the left, live
 * preview in the middle, the chosen block's form on the right. Autosaves the block list on its own
 * (the page autosaves only the paper's details), so the question bank stays in step on the server.
 */
export default function BlockPaperEditor({
  kind = 'paper',
  paperId,
  paperTitle,
  readOnly = false,
  classId,
  subjectId,
  lessonPlanIds,
  onLessonPlanIdsChange,
  onCapturedPaper,
  onSaved,
  // 'structure' (wizard step 2: the paper's shape) or 'fill' (step 3: writing the questions). One editor serves
  // both so the paper is loaded and autosaved in one place.
  mode = 'fill',
  onModeChange,
}) {
  const { showError, showSuccess, showWarning } = useToast()
  // Papers and worksheets (Phase 6b) share this editor; only endpoints, words and header defaults differ.
  const docApi = documentApi(kind)
  const noun = docApi.noun
  const isWorksheet = kind === 'worksheet'

  const { data: registryRes, isError: registryError, refetch: refetchRegistry, isFetching: registryFetching } = useQuery({
    queryKey: ['paperBlockTypes'],
    queryFn: () => questionPaperApi.getBlockTypes(),
    staleTime: 60 * 60 * 1000,
  })
  const registry = registryRes?.data || null

  const { data: documentRes, isLoading: documentLoading, isError: documentError, refetch: refetchDocument, isFetching: documentFetching } = useQuery({
    queryKey: ['paperDocument', kind, paperId],
    queryFn: () => docApi.getDocument(paperId),
    enabled: !!paperId,
    refetchOnWindowFocus: false,
  })

  const [doc, setDoc] = useState(null)
  const [converted, setConverted] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState('saved')
  const [problems, setProblems] = useState([])
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [notPrinted, setNotPrinted] = useState([])
  const docRef = useRef(null)
  const formRef = useRef(null)
  const focusHeadingRef = useRef(false)
  const savingRef = useRef(false)
  const loadedForRef = useRef(null)

  // Load once per paper: later refetches must not overwrite what the teacher is typing.
  useEffect(() => {
    const body = documentRes?.data
    if (!body || loadedForRef.current === paperId) return
    loadedForRef.current = paperId
    const loaded = withItemKeys(body.document || { blocks: [] })
    setDoc(loaded)
    docRef.current = loaded
    setConverted(Boolean(body.converted))
    setSelectedId(loaded.blocks?.[0]?.id || null)
    setDirty(false)
    setSaveState('saved')
  }, [documentRes, paperId])

  const update = useCallback((updater) => {
    setDoc((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      docRef.current = next
      return next
    })
    setDirty(true)
    setSaveState((prev) => (prev === 'saving' ? prev : 'pending'))
  }, [])

  const blocks = useMemo(() => doc?.blocks || [], [doc])
  const numbers = useMemo(() => questionNumbers(blocks, registry), [blocks, registry])
  const total = useMemo(() => documentMarks(doc, registry), [doc, registry])
  const problemMap = useMemo(() => problemsByQuestion(problems), [problems])
  const selectedIndex = blocks.findIndex((b) => b.id === selectedId)
  const selected = selectedIndex >= 0 ? blocks[selectedIndex] : null
  const selectedProblems = selected && numbers[selectedIndex] ? problemMap.get(numbers[selectedIndex]) || [] : []
  const generalProblems = problems.filter((p) => !/^Question \d+:/.test(p))

  // A new question's heading box opened hidden under the sticky top bar on a long paper (demo findings A3), so a
  // new question brings its form on screen and gets the cursor in its heading. Choosing an existing question (in
  // the list or on the preview) only shows its form from the top: moving the window then pulled the list and the
  // paper away from where the teacher was looking.
  useEffect(() => {
    const form = formRef.current
    if (!form || !selectedId) return
    const focus = focusHeadingRef.current
    focusHeadingRef.current = false
    const frame = requestAnimationFrame(() => {
      form.scrollTop = 0 // the panel scrolls on its own on wide screens; another question's form starts at its heading
      const { top, bottom } = form.getBoundingClientRect()
      if (focus && (bottom < 120 || top > window.innerHeight - 120)) form.scrollIntoView({ block: 'start', behavior: 'smooth' })
      if (focus) {
        const heading = form.querySelector('input:not([type=checkbox]), textarea')
        heading?.focus({ preventScroll: true })
        // A block from the menu starts with a generic heading ("Count and write."): selected, so typing replaces it.
        if (focus === 'select') heading?.select?.()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  // ---- autosave
  const save = useCallback(async () => {
    if (readOnly || !paperId || savingRef.current || !docRef.current) return
    savingRef.current = true
    const sent = docRef.current
    setSaveState('saving')
    try {
      const response = await docApi.saveDocument(paperId, sent)
      const saved = response.data?.document || {}
      setDoc((current) => {
        const merged = mergeSavedIds(current, saved)
        docRef.current = merged
        return merged
      })
      setProblems([])
      setConverted(false)
      // Anything typed while the save was on its way is still unsaved.
      const stillDirty = docRef.current !== sent && JSON.stringify(docRef.current) !== JSON.stringify(sent)
      setDirty(stillDirty)
      setSaveState(stillDirty ? 'pending' : 'saved')
      if (stillDirty) setTimeout(() => saveRef.current?.(), SAVE_DELAY_MS)
      onSaved?.(response.data)
    } catch (error) {
      const list = problemsFromError(error)
      if (list) setProblems(list)
      else showError(`The ${noun} could not be saved. Your changes are kept here and are sent again on your next change.`)
      setSaveState('error')
      setDirty(false)
    } finally {
      savingRef.current = false
    }
  }, [docApi, noun, onSaved, paperId, readOnly, showError])

  const saveRef = useRef(null)
  saveRef.current = save

  const saveTrigger = useDebounce(doc, SAVE_DELAY_MS)
  useEffect(() => {
    if (dirty && saveTrigger) save()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTrigger])

  // ---- live preview of the unsaved document. It opens at the question being edited (each edit loads a new page)
  const selectedRef = useRef(null)
  selectedRef.current = selectedId
  const previewTrigger = useDebounce(doc, PREVIEW_DELAY_MS)
  useEffect(() => {
    if (!previewTrigger || !paperId) return
    let cancelled = false
    docApi.previewDocument(paperId, previewTrigger, selectedRef.current)
      .then((res) => { if (!cancelled) { setPreviewHtml(res.data); setPreviewError(null) } })
      .catch((error) => {
        if (cancelled) return
        const list = problemsFromError(error)
        setPreviewError(list ? 'Fix the problems listed to see the preview.' : 'The preview could not be made.')
        if (list) setProblems(list)
      })
    return () => { cancelled = true }
  }, [docApi, paperId, previewTrigger])

  // ---- block actions
  const insertBlocks = (newBlocks, { selectHeading = false } = {}) => {
    if (!newBlocks.length) return
    update((prev) => {
      const list = [...(prev?.blocks || [])]
      const at = selectedIndex >= 0 ? selectedIndex + 1 : list.length
      list.splice(at, 0, ...newBlocks)
      return { ...prev, blocks: list }
    })
    focusHeadingRef.current = selectHeading ? 'select' : true
    setSelectedId(newBlocks[0].id)
  }
  const replaceSelected = (next) => update((prev) => ({ ...prev, blocks: prev.blocks.map((b) => (b.id === next.id ? next : b)) }))
  const move = (index, delta) => update((prev) => ({ ...prev, blocks: moveBlock(prev.blocks, index, delta) }))
  const copy = (index) => {
    const clone = duplicateBlock(blocks[index])
    update((prev) => {
      const list = [...prev.blocks]
      list.splice(index + 1, 0, clone)
      return { ...prev, blocks: list }
    })
    setSelectedId(clone.id)
  }
  const remove = (index) => {
    const gone = blocks[index]
    update((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== gone.id) }))
    if (gone.id === selectedId) setSelectedId(blocks[index + 1]?.id || blocks[index - 1]?.id || null)
  }
  const setHeader = (name, value) => update((prev) => ({ ...prev, header: { ...(prev.header || {}), [name]: value } }))

  // Printing and Word read the saved paper, so save first.
  const withSaved = async (action, label) => {
    setBusy(label)
    try {
      // Let a save already on its way finish, then save whatever is still unsaved.
      for (let waited = 0; savingRef.current && waited < 15000; waited += 150) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      if (dirty || saveState !== 'saved') await save()
      await action()
      setNotPrinted([])
    } catch (error) {
      // A draft prints only once nothing is left to fill (server print_problems); say what is left.
      const left = await stillToFillFromError(error)
      if (left) setNotPrinted(left)
      else showError(`Could not ${label.toLowerCase()} the ${noun}.`)
    } finally {
      setBusy(null)
    }
  }

  if (!paperId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {isWorksheet
          ? 'Choose the class and the subject first.'
          : 'Choose the class, the subject and a title in Paper Setup first. The paper is created as soon as those are set.'}
      </div>
    )
  }
  // A failed load once left only this line and a page reload as the way out (demo findings A6). The block
  // list fails with the paper when the server is away; retrying only the paper then waited on it for ever.
  if ((documentError && !doc) || (registryError && !registry)) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-sm text-red-700">The {noun} could not be opened. Check the connection and try again.</p>
        <Button size="sm" variant="secondary" loading={documentFetching || registryFetching}
          onClick={() => { if (documentError) refetchDocument(); if (registryError) refetchRegistry() }}>Try again</Button>
      </div>
    )
  }
  if (documentLoading || !doc || !registry) return <LoadingState label={`Opening the ${noun}…`} />

  if (mode === 'structure') {
    return (
      <StructureEditor
        blocks={blocks}
        registry={registry}
        kind={kind}
        paperId={paperId}
        classId={classId}
        subjectId={subjectId}
        className={documentRes?.data?.header?.class_name || ''}
        readOnly={readOnly}
        onSkip={() => onModeChange?.('fill')}
        onApply={(next) => {
          update((prev) => ({ ...prev, blocks: next }))
          setSelectedId((next.find((b) => stillToFill(b, registry)) || next[0])?.id || null)
          onModeChange?.('fill')
        }}
      />
    )
  }

  const toFill = blocks.filter((block) => stillToFill(block, registry))
  const nextToFill = () => {
    const after = blocks.slice(selectedIndex + 1).find((block) => stillToFill(block, registry))
    const target = after || toFill[0]
    if (target) setSelectedId(target.id)
  }

  const header = doc.header || {}
  const saveLabel = { saved: 'All changes saved', pending: 'Unsaved changes…', saving: 'Saving…', error: 'Not saved' }[saveState]

  return (
    <div className="space-y-4">
      {converted && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          This {noun} was made with the old builder and is shown here as blocks. It is saved in the new form when you change something.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
        <div className="text-sm text-gray-700">
          {(!isWorksheet || total > 0) && <span className="font-semibold text-gray-900">Total marks: {formatMarks(total)}</span>}
          <span className={`ml-3 ${saveState === 'error' ? 'text-red-600' : 'text-gray-500'}`} role="status">{readOnly ? 'Read only' : saveLabel}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy === 'Print'} onClick={() => withSaved(() => printPaper(paperId, paperTitle, kind), 'Print')}>
            Print / Save as PDF
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'Key'} onClick={() => withSaved(() => printAnswerKey(paperId, paperTitle, kind), 'Key')}>
            Answer key
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'Download'} onClick={() => withSaved(() => downloadPaperWord(paperId, paperTitle, kind), 'Download')}>
            Download Word
          </Button>
        </div>
      </div>

      {notPrinted.length > 0 && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Not printed yet: fill these first.</p>
            <button type="button" onClick={() => setNotPrinted([])} className="text-xs text-amber-800 hover:underline">Close</button>
          </div>
          <ul className="list-disc pl-5 mt-1">
            {notPrinted.slice(0, 8).map((line) => <li key={line}>{line.replace(/^Still to fill: /, '')}</li>)}
            {notPrinted.length > 8 && <li>and {notPrinted.length - 8} more</li>}
          </ul>
        </div>
      )}

      {generalProblems.length > 0 && (
        <ul className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 list-disc pl-6">
          {generalProblems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_26rem] gap-4 items-start">
        {/* Outline */}
        <aside className="bg-white border border-gray-200 rounded-lg">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Questions</h3>
            <span className="text-xs text-gray-500">{numbers.filter(Boolean).length}</span>
          </div>
          {toFill.length > 0 && !readOnly && (
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 bg-amber-50">
              <span className="text-xs text-amber-800">{toFill.length} still to fill</span>
              <Button size="sm" variant="secondary" onClick={nextToFill}>Next to fill</Button>
            </div>
          )}
          <ol className="max-h-[70vh] overflow-y-auto">
            {blocks.map((block, index) => {
              const number = numbers[index]
              const flagged = number && problemMap.has(number)
              const isSelected = block.id === selectedId
              const todo = stillToFill(block, registry)
              return (
                <li key={block.id} className={`border-b border-gray-100 ${isSelected ? 'bg-blue-50' : ''}`}>
                  <button type="button" onClick={() => setSelectedId(block.id)} className="w-full text-left px-3 py-2">
                    <span className="flex items-start gap-2">
                      <span className={`text-xs font-semibold mt-0.5 ${flagged ? 'text-red-600' : 'text-gray-500'}`}>
                        {number ? `Q${number}` : '§'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm truncate ${todo ? 'text-gray-500' : 'text-gray-900'}`}>{block.title || '(no heading)'}</span>
                        <span className="block text-xs text-gray-500 truncate">
                          {blockSummary(block, registry)}{isQuestionBlock(block, registry) && (!isWorksheet || block.marks != null) ? ` · ${block.marks ?? 0} marks` : ''}
                        </span>
                      </span>
                      {flagged && <span className="text-xs text-red-600" title="Has problems">●</span>}
                      {!flagged && todo && <span className="text-xs text-amber-500" title="Still to fill">●</span>}
                    </span>
                  </button>
                  {isSelected && !readOnly && (
                    <div className="flex gap-1 px-3 pb-2 text-xs">
                      <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="px-1.5 py-0.5 border border-gray-300 rounded disabled:opacity-30" aria-label="Move up">↑</button>
                      <button type="button" onClick={() => move(index, 1)} disabled={index === blocks.length - 1} className="px-1.5 py-0.5 border border-gray-300 rounded disabled:opacity-30" aria-label="Move down">↓</button>
                      <button type="button" onClick={() => copy(index)} className="px-1.5 py-0.5 border border-gray-300 rounded">Copy</button>
                      <button type="button" onClick={() => remove(index)} className="px-1.5 py-0.5 border border-red-200 text-red-600 rounded ml-auto">Delete</button>
                    </div>
                  )}
                </li>
              )
            })}
            {blocks.length === 0 && (
              <li className="px-3 py-4 text-sm text-gray-500 space-y-2">
                <p>No questions yet.</p>
                {onModeChange && !readOnly && (
                  <Button size="sm" onClick={() => onModeChange('structure')}>Plan the structure first</Button>
                )}
              </li>
            )}
          </ol>
          {!readOnly && (
            <div className="p-3 space-y-2 border-t border-gray-100">
              <Button className="w-full" onClick={() => setAddOpen(true)}>+ Add question</Button>
              {onModeChange && blocks.length > 0 && (
                <Button className="w-full" variant="secondary" onClick={() => onModeChange('structure')}>Change the structure</Button>
              )}
              <Button className="w-full" variant="secondary" onClick={() => setBankOpen(true)}>From question bank</Button>
              <Button className="w-full" variant="secondary" onClick={() => setPhotoOpen(true)}>From a photo of a {noun}</Button>
            </div>
          )}
          <div className="p-3 border-t border-gray-100 space-y-2">
            <p className="text-xs font-semibold text-gray-700">{isWorksheet ? 'Worksheet header' : 'Paper header'}</p>
            {isWorksheet && (
              <label className="block text-sm text-gray-700">
                Header style
                <select value={header.header_style === 'compact' ? 'compact' : 'standard'} disabled={readOnly}
                  onChange={(e) => setHeader('header_style', e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                  <option value="compact">Compact: logo and one box</option>
                  <option value="standard">Standard: school name and title</option>
                </select>
              </label>
            )}
            <label className="block text-sm text-gray-700">
              {isWorksheet ? 'Language' : 'Paper language'}
              <select value={doc.direction === 'rtl' ? 'rtl' : 'ltr'} disabled={readOnly}
                onChange={(e) => update((prev) => ({ ...prev, direction: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                <option value="ltr">English (left to right)</option>
                <option value="rtl">اردو Urdu (right to left)</option>
              </select>
            </label>
            {!isWorksheet && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={headerSwitchOn(header, 'marks_table', kind)} disabled={readOnly} onChange={(e) => setHeader('marks_table', e.target.checked)} />
                “For office use” marks table
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={header.show_logo !== false} disabled={readOnly} onChange={(e) => setHeader('show_logo', e.target.checked)} />
              School logo
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={headerSwitchOn(header, 'show_time_marks', kind)} disabled={readOnly} onChange={(e) => setHeader('show_time_marks', e.target.checked)} />
              {isWorksheet ? 'Total marks line' : 'Time and total marks line'}
            </label>
            {!isWorksheet && (
              <label className="block text-sm text-gray-700">
                Signature label
                <input value={header.sign_label ?? 'Teacher’s Sign'} disabled={readOnly} onChange={(e) => setHeader('sign_label', e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
              </label>
            )}
          </div>
        </aside>

        {/* Preview */}
        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden order-last lg:col-span-2 xl:col-span-1 xl:order-none xl:sticky xl:top-20">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-800">Preview</h3>
            <div className="flex items-center gap-3">
              {previewError && <span className="text-xs text-red-600">{previewError}</span>}
              <button type="button" onClick={() => setFullPreviewOpen(true)} disabled={!previewHtml}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40">Full size</button>
            </div>
          </div>
          <A4Preview
            show={selectedId || ''}
            onPick={setSelectedId}
            title={isWorksheet ? 'Worksheet preview' : 'Paper preview'}
            html={previewHtml || '<p style="font-family:sans-serif;color:#64748b;padding:16px">Making the preview…</p>'}
          />
        </section>

        {/* Form */}
        {/* Paper and form stay on screen while the page scrolls (xl), so choosing a question never needs to move it. */}
        <aside ref={formRef} className="bg-white border border-gray-200 rounded-lg p-4 min-w-0 scroll-mt-20 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <PaperDirectionContext.Provider value={doc.direction === 'rtl' ? 'rtl' : 'ltr'}>
            <BlockForm key={selected?.id || 'none'} block={selected} registry={registry} onChange={replaceSelected} readOnly={readOnly} problems={selectedProblems} optionalMarks={isWorksheet} />
          </PaperDirectionContext.Provider>
        </aside>
      </div>

      <TypePicker
        open={addOpen}
        onClose={() => setAddOpen(false)}
        registry={registry}
        early={isEarlyClass(documentRes?.data?.header?.class_name)}
        used={blocks.map((block) => block.type)}
        onPick={(type) => insertBlocks([newBlockFor(kind, type, registry, blocks)], { selectHeading: true })}
      />

      <QuestionBankPicker
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        classId={classId}
        subjectId={subjectId}
        lessonPlanIds={lessonPlanIds}
        onLessonPlanIdsChange={onLessonPlanIdsChange}
        onAttach={(questions) => {
          insertBlocks(bankQuestionsToBlocks(questions))
          setBankOpen(false)
          // A warning when an old activity without its drawing was left out, so it is not missed.
          ;(questions.some(isLostActivity) ? showWarning : showSuccess)(bankAddedMessage(questions))
        }}
      />

      {fullPreviewOpen && (
        <Modal open onClose={() => setFullPreviewOpen(false)} title={isWorksheet ? 'Worksheet preview' : 'Paper preview'} size="4xl">
          <A4Preview title={isWorksheet ? 'Worksheet full size' : 'Paper full size'} html={previewHtml} height="80vh" />
        </Modal>
      )}

      {photoOpen && (
        <Modal open onClose={() => setPhotoOpen(false)} title={`Add questions from a photo of a ${noun}`} size="5xl" closeOnBackdrop={false}>
          <ImageCapturePaperTab
            classId={classId}
            subjectId={subjectId}
            onApplyPrefill={(prefill) => {
              const added = capturedPaperToBlocks(prefill)
              // An empty paper takes the photo's direction, so a scanned Urdu paper prints right to left.
              if (prefill.direction && !blocks.length) update((prev) => ({ ...prev, direction: prefill.direction }))
              insertBlocks(added)
              setPhotoOpen(false)
              onCapturedPaper?.(prefill)
              showSuccess(`${added.length} block${added.length === 1 ? '' : 's'} added from the photo. Check them before printing.`)
            }}
          />
        </Modal>
      )}
    </div>
  )
}
