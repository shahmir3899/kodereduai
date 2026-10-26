import { useEffect, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import useMobileVideo from '../../hooks/useMobileVideo'
import { hasMobileVideo, videoFile, videoUrl } from '../../utils/guideAssets'
import GuideVideoPlayer from './GuideVideoPlayer'

const LANGS = [['en', 'English'], ['ur', 'اردو']]

/**
 * A tutorial video in a dialog over the page, so the reader keeps their place. The language switch
 * continues from the same moment, because the English and Urdu videos follow the same steps. When a
 * video ends it offers the next one from the same group.
 */
export default function GuideVideoModal({ video, lang, onLang, onClose, nextVideo = null, onNext, onPlayed, resumeAt = 0 }) {
  const timeRef = useRef(0)
  const startAtRef = useRef(0)
  const [ended, setEnded] = useState(false)
  const [restartKey, setRestartKey] = useState(0)
  const [resumed, setResumed] = useState(resumeAt > 0)
  const mobile = useMobileVideo() && hasMobileVideo(video)
  const file = (ext) => videoUrl(videoFile(video, lang, ext, mobile))

  // A different video starts clean: not ended, and from where this person stopped last time, if they did.
  useEffect(() => {
    timeRef.current = 0
    startAtRef.current = resumeAt > 0 ? resumeAt : 0
    setEnded(false)
    setResumed(resumeAt > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id])

  const switchLang = (code) => {
    if (code === lang) return
    startAtRef.current = timeRef.current
    setEnded(false)
    onLang(code)
  }

  const nextTitle = nextVideo ? (nextVideo.title?.[lang] || nextVideo.title?.en) : null

  return (
    <Modal open onClose={onClose} size="4xl" title={<span dir={lang === 'ur' ? 'rtl' : 'ltr'}>{video.title[lang] || video.title.en}</span>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300" role="group" aria-label="Video language">
          {LANGS.map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => switchLang(code)}
              aria-pressed={lang === code}
              className={`px-3 py-1.5 text-sm ${lang === code ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'} ${code === 'ur' ? 'border-l border-gray-300' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Chapter {video.chapter}</span>
          {nextVideo && (
            <button type="button" onClick={() => onNext(nextVideo.id)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Next video &rarr;
            </button>
          )}
        </div>
      </div>

      <GuideVideoPlayer
        src={file('mp4')}
        captionsSrc={file('vtt')}
        captionsLang={lang}
        captionsLabel={lang === 'ur' ? 'اردو' : 'English'}
        poster={file('poster.jpg')}
        portrait={mobile}
        startAt={startAtRef.current}
        restartKey={restartKey}
        onTime={(t) => { timeRef.current = t }}
        onPlayed={(played) => onPlayed?.(video.id, { ...played, language: lang })}
        onEnded={() => setEnded(true)}
      />

      {resumed && !ended && (
        <p className="mt-2 text-xs text-gray-500">
          Continuing where you left off.{' '}
          <button type="button" onClick={() => { setResumed(false); setRestartKey((k) => k + 1) }} className="text-primary-600 hover:underline">Start over</button>
        </p>
      )}

      {ended && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3" role="status">
          <p className="text-sm font-medium text-green-800">
            {nextVideo ? <>Up next: <span dir={lang === 'ur' ? 'rtl' : 'ltr'}>{nextTitle}</span></> : 'That was the last video in this group.'}
          </p>
          {nextVideo
            ? <button type="button" onClick={() => onNext(nextVideo.id)} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700">Play next</button>
            : <button type="button" onClick={onClose} className="rounded-md border border-green-300 px-3 py-1.5 text-sm text-green-800 hover:bg-green-100">Close</button>}
        </div>
      )}

      {video.summary && <p className="mt-3 text-sm text-gray-600">{video.summary}</p>}
    </Modal>
  )
}
