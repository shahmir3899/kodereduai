import { useRef } from 'react'
import Modal from '../ui/Modal'
import GuideVideoPlayer from './GuideVideoPlayer'

const LANGS = [['en', 'English'], ['ur', 'اردو']]

/**
 * A tutorial video in a dialog over the page, so the reader keeps their place. The language switch
 * continues from the same moment, because the English and Urdu videos follow the same steps.
 */
export default function GuideVideoModal({ video, lang, onLang, onClose }) {
  const timeRef = useRef(0)
  const startAtRef = useRef(0)
  const base = `/videos/${video.id}.${lang}`

  const switchLang = (code) => {
    if (code === lang) return
    startAtRef.current = timeRef.current
    onLang(code)
  }

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
        <span className="text-xs text-gray-500">Chapter {video.chapter}</span>
      </div>

      <GuideVideoPlayer
        src={`${base}.mp4`}
        captionsSrc={`${base}.vtt`}
        captionsLang={lang}
        captionsLabel={lang === 'ur' ? 'اردو' : 'English'}
        poster={`${base}.poster.jpg`}
        startAt={startAtRef.current}
        onTime={(t) => { timeRef.current = t }}
      />

      {video.summary && <p className="mt-3 text-sm text-gray-600">{video.summary}</p>}
    </Modal>
  )
}
