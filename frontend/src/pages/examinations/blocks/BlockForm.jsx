import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import RichTextEditor from '../../../components/RichTextEditor'
import Button from '../../../components/ui/Button'
import PicturePicker, { describePicture, usePictureLookups } from './PicturePicker'
import { blockSpec, isQuestionBlock, newListItem, numberFromText, countingList, rowsWithPictures, splitListText, withMarks } from './blockDocument'
import { picturesFromNames } from './pictureRefs'

export { splitListText }

// The form for one block, built from the field list the server sends (GET paper-blocks/), so a new
// block type on the server needs no new form here. Field kinds: see backend paper_blocks/registry.py.

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50'

function PictureField({ value, onChange, optional, readOnly }) {
  const [open, setOpen] = useState(false)
  const lookups = usePictureLookups()
  const shown = describePicture(value, lookups)
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-14 shrink-0 border border-gray-200 rounded-lg bg-white flex items-center justify-center overflow-hidden">
        {shown?.image ? <img src={shown.image} alt="" className="max-w-full max-h-full object-contain" /> : (
          <span className="text-[10px] text-gray-400 text-center px-1">{value ? 'drawn' : 'none'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800 truncate">{shown?.label || 'No picture'}</p>
        {!readOnly && (
          <div className="flex gap-2 mt-1">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{value ? 'Change' : 'Choose'}</Button>
            {optional && value && <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>Remove</Button>}
          </div>
        )}
      </div>
      <PicturePicker open={open} onClose={() => setOpen(false)} onPick={onChange} />
    </div>
  )
}

function TextList({ value, onChange, field, readOnly }) {
  const entries = Array.isArray(value) ? value : []
  const max = field.max ?? 60
  const inputs = useRef([])
  const focusNext = useRef(null)
  const [all, setAll] = useState('')
  const [upTo, setUpTo] = useState('10')
  const [gap, setGap] = useState('2')
  const set = (index, next) => onChange(entries.map((entry, i) => (i === index ? next : entry)))
  // "+ Add" and Enter put the cursor in the new box: each value used to need a separate click (demo findings B2).
  const add = () => {
    if (entries.length >= max) return
    focusNext.current = entries.length
    onChange([...entries, ''])
  }
  useEffect(() => {
    if (focusNext.current === null) return
    inputs.current[focusNext.current]?.focus()
    focusNext.current = null
  })
  const fillAll = () => {
    if (!all.trim()) return
    onChange(splitListText(all, max))
    setAll('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((entry, index) => (
          <div key={index} className="flex items-center">
            <input
              ref={(el) => { inputs.current[index] = el }}
              dir="auto"
              value={entry}
              onChange={(e) => set(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (index === entries.length - 1) add()
                else inputs.current[index + 1]?.focus()
              }}
              disabled={readOnly}
              aria-label={`${field.label} ${index + 1}`}
              placeholder="empty"
              className="w-20 px-2 py-1 border border-gray-300 rounded-l-md text-sm"
            />
            {!readOnly && (
              <button type="button" aria-label="Remove" onClick={() => onChange(entries.filter((_, i) => i !== index))}
                className="px-1.5 py-1 border border-l-0 border-gray-300 rounded-r-md text-gray-500 hover:text-red-600 text-sm">×</button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && entries.length < max && (
        <button type="button" onClick={add} className="mt-1.5 text-sm text-blue-600 hover:text-blue-800">+ Add</button>
      )}
      {!readOnly && (
        // One line for the whole list instead of a click per box (demo findings B1).
        <div className="mt-2 flex gap-2">
          <input
            dir="auto"
            value={all}
            onChange={(e) => setAll(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fillAll() } }}
            aria-label={`${field.label}: type them all`}
            placeholder="Or type them all: 1, , 3, , 5"
            className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded-md text-sm"
          />
          <Button size="sm" variant="secondary" onClick={fillAll} disabled={!all.trim()}>Fill</Button>
        </div>
      )}
      {!readOnly && field.counting && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-gray-700">
          <span>Or count 1 to</span>
          <input type="number" min={1} max={max} value={upTo} onChange={(e) => setUpTo(e.target.value)}
            aria-label={`${field.label}: count up to`} className="w-16 px-2 py-1 border border-gray-300 rounded-md text-sm" />
          <span>, leave a box empty every</span>
          <input type="number" min={0} max={max} value={gap} onChange={(e) => setGap(e.target.value)}
            aria-label={`${field.label}: leave a box empty every`} className="w-14 px-2 py-1 border border-gray-300 rounded-md text-sm" />
          <Button size="sm" variant="secondary" onClick={() => onChange(countingList(upTo, gap, max))} disabled={!(Number(upTo) >= 1)}>Fill</Button>
        </div>
      )}
    </div>
  )
}

function LetterRows({ value, onChange, readOnly }) {
  const text = (Array.isArray(value) ? value : []).map((row) => (Array.isArray(row) ? row.join(' ') : '')).join('\n')
  return (
    <>
      <textarea
        dir="auto"
        defaultValue={text}
        onBlur={(e) => onChange(e.target.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/)))}
        disabled={readOnly}
        rows={4}
        className={inputClass}
      />
      <p className="text-xs text-gray-500 mt-1">One row per line, letters separated by spaces.</p>
    </>
  )
}

function ListField({ field, value, onChange, readOnly, depth }) {
  const items = Array.isArray(value) ? value : []
  // A row that needs a picture (Count and write, picture cards) is added only once its picture is chosen: an
  // empty row made the whole paper fail to save until it was filled (demo findings A5).
  const pictureSub = (field.fields || []).find((sub) => sub.kind === 'picture' && !sub.optional)
  const [pickingNew, setPickingNew] = useState(false)
  const addItem = (picture) => onChange([...items, { ...newListItem(field), ...(pictureSub ? { [pictureSub.name]: picture } : {}) }])
  const max = field.max ?? 60
  const min = field.min ?? 0
  const singular = field.name === 'options' ? 'option' : field.name === 'rows' ? 'row' : 'part'
  const update = (index, next) => onChange(items.map((item, i) => (i === index ? next : item)))
  const move = (index, delta) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }
  const label = (index) => (field.name === 'options' ? String.fromCharCode(65 + index) : `${index + 1}`)
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={item?.key || index} className={`rounded-lg border ${depth ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'} p-2.5`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-gray-600">{field.name === 'options' ? 'Option' : singular[0].toUpperCase() + singular.slice(1)} {label(index)}</span>
            {!readOnly && (
              <div className="flex gap-1 text-xs">
                <button type="button" aria-label="Move up" onClick={() => move(index, -1)} disabled={index === 0} className="px-1.5 text-gray-500 disabled:opacity-30">↑</button>
                <button type="button" aria-label="Move down" onClick={() => move(index, 1)} disabled={index === items.length - 1} className="px-1.5 text-gray-500 disabled:opacity-30">↓</button>
                <button type="button" aria-label="Remove" onClick={() => onChange(items.filter((_, i) => i !== index))} disabled={items.length <= min}
                  className="px-1.5 text-red-600 disabled:opacity-30">Remove</button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {(field.fields || []).map((sub) => (
              <FieldInput
                key={sub.name}
                field={sub}
                value={item?.[sub.name]}
                onChange={(next) => {
                  const copy = { ...item }
                  if (next === undefined) delete copy[sub.name]
                  else copy[sub.name] = next
                  update(index, copy)
                }}
                readOnly={readOnly}
                depth={depth + 1}
                compact
              />
            ))}
          </div>
        </div>
      ))}
      {!readOnly && items.length < max && (
        <button type="button" onClick={() => (pictureSub ? setPickingNew(true) : addItem())} className="text-sm text-blue-600 hover:text-blue-800">
          + Add {singular}
        </button>
      )}
      {pictureSub && <PicturePicker open={pickingNew} onClose={() => setPickingNew(false)} onPick={(ref) => addItem(ref)} />}
      {!readOnly && depth === 0 && (field.fields || []).some((sub) => sub.kind === 'picture')
        && !(field.fields || []).some((sub) => sub.kind === 'richtext') && (
        <PictureNamesBox field={field} items={items} onChange={onChange} />
      )}
    </div>
  )
}

// Several rows from one line of picture names (Count and write, Match the columns): one picker search per
// picture was 15 openings in the demo paper (faster 4).
function PictureNamesBox({ field, items, onChange }) {
  const { catalog } = usePictureLookups()
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const counted = (field.fields || []).some((sub) => sub.name === 'count' && sub.kind === 'int')
  const fill = () => {
    if (!text.trim()) return
    const { found, unknown } = picturesFromNames(text, catalog)
    const { rows, dropped } = rowsWithPictures(field, items, found)
    if (found.length) onChange(rows)
    const notes = []
    if (unknown.length) notes.push(`Not in the library: ${unknown.join(', ')}. Search for them in the picture picker.`)
    if (dropped) notes.push(`${dropped} did not fit (at most ${field.max ?? 60}).`)
    setNote(notes.join(' '))
    // Unknown names stay in the box so they can be corrected.
    setText(unknown.join(', '))
  }
  return (
    <div className="pt-1">
      <div className="flex gap-2">
        <input
          dir="auto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fill() } }}
          aria-label={`${field.label}: picture names`}
          placeholder={counted ? 'Or type pictures: butterfly 3, flower 2' : 'Or type pictures: apple, ball, cat'}
          className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded-md text-sm"
        />
        <Button size="sm" variant="secondary" onClick={fill} disabled={!text.trim()}>Add</Button>
      </div>
      {note && <p className="mt-1 text-xs text-amber-700" role="status">{note}</p>}
    </div>
  )
}

// The paper's direction ('rtl' for Urdu papers): new rich-text boxes open in Urdu.
/**
 * A number box that keeps what is typed while it has the cursor and only applies the field's limits
 * when the teacher leaves it. In-range numbers still reach the paper as they are typed, so the preview follows.
 */
export function NumberBox({ id, value, onCommit, limits, readOnly, className, placeholder, ariaLabel }) {
  const [text, setText] = useState(null)
  const shown = text ?? (value === undefined || value === null ? '' : String(value))
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={shown}
      min={limits.min}
      max={limits.max}
      step={limits.integer ? 1 : 0.5}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => setText(value === undefined || value === null ? '' : String(value))}
      onChange={(e) => {
        setText(e.target.value)
        const { value: next, complete } = numberFromText(e.target.value, limits)
        if (complete && next !== value) onCommit(next)
      }}
      onBlur={() => {
        const { value: next } = numberFromText(text ?? shown, limits)
        if (next !== value) onCommit(next)
        setText(null)
      }}
      disabled={readOnly}
      className={className}
    />
  )
}

export const PaperDirectionContext = createContext('ltr')

export function FieldInput({ field, value, onChange, readOnly = false, depth = 0, compact = false }) {
  const id = useId()
  const direction = useContext(PaperDirectionContext)
  const label = `${field.label}${field.optional ? ' (optional)' : ''}`
  // Single-box fields get a real <label for>, so screen readers name the box.
  const single = ['text', 'int', 'number', 'choice'].includes(field.kind)
  let control
  switch (field.kind) {
    case 'richtext':
      control = readOnly
        ? <p className="text-sm text-gray-800 whitespace-pre-wrap">{String(value || '').replace(/<[^>]*>/g, ' ').trim() || '—'}</p>
        : <RichTextEditor value={value || ''} onChange={onChange} placeholder={field.label} defaultLanguage={direction === 'rtl' ? 'ur' : 'en'} />
      break
    case 'text':
      control = (
        <input id={id} dir="auto" value={value ?? ''} maxLength={field.max_length} onChange={(e) => onChange(e.target.value)} disabled={readOnly} className={inputClass} />
      )
      break
    case 'int':
    case 'number':
      control = (
        <NumberBox
          id={id}
          value={value}
          onCommit={onChange}
          limits={{ min: field.min, max: field.max, integer: field.kind === 'int', optional: field.optional, fallback: field.default }}
          readOnly={readOnly}
          className={`${inputClass} max-w-[8rem]`}
        />
      )
      break
    case 'bool':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={readOnly} />
          {field.label}
        </label>
      )
    case 'choice':
      control = (
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} disabled={readOnly} className={`${inputClass} max-w-[14rem]`}>
          {field.optional && <option value="">—</option>}
          {field.choices.map((choice) => <option key={choice} value={choice}>{field.labels?.[choice] ?? choice}</option>)}
        </select>
      )
      break
    case 'picture':
      control = <PictureField value={value} onChange={onChange} optional={field.optional} readOnly={readOnly} />
      break
    case 'text_list':
      control = <TextList value={value} onChange={onChange} field={field} readOnly={readOnly} />
      break
    case 'letter_rows':
      control = <LetterRows value={value} onChange={onChange} readOnly={readOnly} />
      break
    case 'list':
      control = <ListField field={field} value={value} onChange={onChange} readOnly={readOnly} depth={depth} />
      break
    default:
      control = <p className="text-xs text-gray-500">Unsupported field “{field.kind}”.</p>
  }
  return (
    <div>
      {single ? (
        <label htmlFor={id} className={`block ${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-700 mb-1`}>{label}</label>
      ) : (
        <span className={`block ${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-700 mb-1`}>{label}</span>
      )}
      {field.help && <span className="block text-xs text-gray-500 mb-1">{field.help}</span>}
      {control}
    </div>
  )
}

/** Title, marks and the block's own fields. */
export default function BlockForm({ block, registry, onChange, readOnly = false, problems = [], optionalMarks = false }) {
  const spec = blockSpec(registry, block?.type)
  if (!block || !spec) return <p className="text-sm text-gray-500">Choose a question on the left to edit it.</p>
  const question = isQuestionBlock(block, registry)
  const setData = (name, value) => {
    const data = { ...(block.data || {}) }
    if (value === undefined) delete data[name]
    else data[name] = value
    onChange({ ...block, data })
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{spec.label}</p>
        {problems.length > 0 && (
          <ul className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 list-disc pl-6">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
      </div>
      <div className={question ? 'grid grid-cols-[1fr_auto] gap-3' : ''}>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">{question ? 'Question heading' : 'Heading'}</span>
          <input dir="auto" value={block.title || ''} onChange={(e) => onChange({ ...block, title: e.target.value })} disabled={readOnly} className={inputClass} />
        </label>
        {question && (
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">{optionalMarks ? 'Marks (optional)' : 'Marks'}</span>
            <NumberBox
              value={block.marks}
              onCommit={(next) => onChange(withMarks(block, next ?? '', optionalMarks))}
              limits={{ min: 0, optional: optionalMarks, fallback: 0 }}
              placeholder={optionalMarks ? 'none' : undefined}
              readOnly={readOnly}
              className={`${inputClass} w-24`}
            />
          </label>
        )}
      </div>
      {spec.fields.map((field) => (
        <FieldInput key={field.name} field={field} value={block.data?.[field.name]} onChange={(value) => setData(field.name, value)} readOnly={readOnly} />
      ))}
    </div>
  )
}
