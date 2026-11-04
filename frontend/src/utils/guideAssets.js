// Where guide videos, posters and captions are fetched from: <base>/guide/<file>. Empty means the same site (local dev
// serves the repo's media/guide folder at /guide);
// both the signed-in app and the public guide on the marketing site point this at the media host, so the files are
// stored once and never bundled into either build.
const clean = (url) => (url || '').replace(/\/$/, '')

// The signed-in app takes it from the build env; the marketing site calls setVideoBase with its own PUBLIC_ value.
let base = clean(import.meta.env?.VITE_GUIDE_VIDEO_BASE)
let context = null

export const setVideoBase = (url) => { base = clean(url) }

// The Expo app calls this with 'app' so it gets its own recordings; browsers leave it unset and the screen decides.
export const setVideoContext = (value) => { context = value || null }
export const getVideoContext = () => context

export const videoUrl = (file) => `${base}/guide/${file}`

// Captions loaded from another origin are only readable when the media request is made with CORS.
export const videoCrossOrigin = () => (base ? 'anonymous' : undefined)

// File-name suffix per variant, and what each kind of viewer falls back to. A variant counts as published once the
// entry carries seconds for it, so videos can be published in batches and the next-best recording is used meanwhile.
const SUFFIX = { desktop: '', mobile: 'm.', app: 'a.' }
const CHAINS = {
  desktop: ['desktop'],
  mobile: ['mobile', 'desktop'],
  app: ['app', 'mobile', 'desktop'],
}

const variantSeconds = (video, variant) => (variant === 'desktop' ? video?.seconds : video?.variants?.[variant] || (variant === 'mobile' ? video?.mobile : undefined))

export const hasVariant = (video, variant) => Boolean(variantSeconds(video, variant))
export const hasMobileVideo = (video) => hasVariant(video, 'mobile')

export const pickVariant = (video, viewer = 'desktop') => (CHAINS[viewer] || CHAINS.desktop).find((v) => v === 'desktop' || hasVariant(video, v)) || 'desktop'

// Phone-shaped recordings play in a portrait frame.
export const isPortrait = (variant) => variant !== 'desktop'

export const videoFile = (video, lang, ext, viewer = 'desktop') => `${video.id}.${lang}.${SUFFIX[pickVariant(video, viewer)]}${ext}`
export const videoSeconds = (video, lang, viewer = 'desktop') => {
  const s = variantSeconds(video, pickVariant(video, viewer))
  return (s?.[lang] || s?.en) || 0
}
