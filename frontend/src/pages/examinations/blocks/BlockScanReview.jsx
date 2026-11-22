import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../../services/api'
import PaperPageViewer from '../PaperPageViewer'
import { describePicture, usePictureLookups } from './PicturePicker'
import { blockPictures, blockSpec, isQuestionBlock } from './blockDocument'

/**
 * What the photo scan read (Paper Builder v2), beside the photo: one card per block with its kind,
 * title, marks and pictures. The teacher unticks anything wrong and adds the rest; fixing details
 * happens in the editor afterwards, where the live preview is.
 *
 * result: group-status `result` for a block scan ({ blocks, header, notes, pictures }).
 */
export default function BlockScanReview({ result, pages = [], onAccept, onStartOver }) {
  const { data: registryRes } = useQuery({
    queryKey: ['paperBlockTypes'],
    queryFn: () => questionPaperApi.getBlockTypes(),
    staleTime: 60 * 60 * 1000,
  })
  const registry = registryRes?.data || null
  const lookups = usePictureLookups()
  const blocks = useMemo(() => result?.blocks || [], [result])
  const [skipped, setSkipped] = useState(() => new Set())
  const [activePage, setActivePage] = useState(pages[0]?.page_number || 1)
  const [showPhoto, setShowPhoto] = useState(true)

  const kept = blocks.filter((block, index) => !skipped.has(index))
  const marks = kept.reduce((sum, block) => sum + (isQuestionBlock(block, registry) ? Number(block.marks) || 0 : 0), 0)
  const printedTotal = Number(result?.header?.total_marks) || null
  const pictures = result?.pictures || {}
  const notes = result?.notes || []
  const photoOn = showPhoto && pages.length > 0

  const toggle = (index) => setSkipped((prev) => {
    const next = new Set(prev)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  let number = 0
  return (
    <div className={photoOn ? 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' : ''}>
      {photoOn && (
        <div className="lg:sticky lg:top-2 h-[70vh] lg:h-[calc(100vh-6rem)]">
          <PaperPageViewer pages={pages} activePage={activePage} onPageChange={setActivePage} />
        </div>
      )}
      <div className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-700 flex-1 min-w-0">
            <span className="font-medium">{blocks.length} question{blocks.length === 1 ? '' : 's'}</span> read from
            {' '}{pages.length || 1} page{pages.length === 1 ? '' : 's'}.
            {(pictures.library || pictures.cropped) ? ` Pictures: ${pictures.library || 0} from the library, ${pictures.cropped || 0} cut from the photo.` : ''}
            {' '}Untick anything that is wrong; you can fix the rest in the editor.
          </p>
          {pages.length > 0 && (
            <button type="button" onClick={() => setShowPhoto((v) => !v)} className="text-sm text-gray-600 hover:text-gray-800 underline">
              {showPhoto ? 'Hide photo' : 'Show photo'}
            </button>
          )}
          <button type="button" onClick={onStartOver} className="text-sm text-gray-600 hover:text-gray-800 underline">Start over</button>
        </div>

        {notes.length > 0 && (
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="status">
            <p className="font-medium">Check these:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        )}

        <ol className="space-y-2">
          {blocks.map((block, index) => {
            const spec = blockSpec(registry, block.type)
            const isQuestion = isQuestionBlock(block, registry)
            if (isQuestion) number += 1
            const included = !skipped.has(index)
            const thumbs = blockPictures(block).slice(0, 8).map((ref) => describePicture(ref, lookups))
            return (
              <li
                key={block.id || index}
                className={`p-3 rounded-lg border ${included ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}
                onClick={() => block.page_number && setActivePage(block.page_number)}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={() => toggle(index)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Add ${isQuestion ? `question ${number}` : 'heading'} to the paper`}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">
                      {isQuestion ? `Q${number} · ` : ''}{spec?.label || block.type}
                      {block.page_number && pages.length > 1 ? ` · page ${block.page_number}` : ''}
                    </p>
                    <p className="text-sm text-gray-900 break-words">{block.title || <em className="text-gray-400">No instruction read</em>}</p>
                    {thumbs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {thumbs.map((picture, i) => (
                          picture?.image
                            ? <img key={i} src={picture.image} alt={picture.label} title={picture.label} className="h-10 w-10 object-contain rounded border border-gray-200 bg-white" />
                            : (
                              <span key={i} title="Not found: pick a picture in the editor" className="h-10 min-w-10 px-1 flex items-center justify-center text-[10px] text-gray-500 rounded border border-dashed border-gray-400">
                                {picture?.label || 'picture'}
                              </span>
                            )
                        ))}
                      </div>
                    )}
                  </div>
                  {isQuestion && <span className="text-xs text-gray-500 shrink-0">{block.marks ?? 0} mark{Number(block.marks) === 1 ? '' : 's'}</span>}
                </div>
              </li>
            )
          })}
        </ol>

        {printedTotal && (
          <p className={`text-sm px-3 py-2 rounded-lg border ${marks === printedTotal ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            {marks === printedTotal
              ? `${marks} / ${printedTotal} marks: the questions add up to the total on the paper.`
              : `The questions add up to ${marks} marks; the paper says ${printedTotal}. Check the marks in the editor.`}
          </p>
        )}

        <div className="flex justify-end pt-2 border-t border-gray-200">
          <button
            type="button"
            onClick={() => onAccept(kept)}
            disabled={kept.length === 0}
            className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add {kept.length} to the paper
          </button>
        </div>
      </div>
    </div>
  )
}
