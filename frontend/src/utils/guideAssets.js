// Where guide videos, posters and captions are fetched from. Empty means the same site (the signed-in app);
// the public guide on the marketing site points this at the app's host so the videos are stored only once.
let base = ''

export const setVideoBase = (url) => { base = (url || '').replace(/\/$/, '') }

export const videoUrl = (file) => `${base}/videos/${file}`

// Captions loaded from another origin are only readable when the media request is made with CORS.
export const videoCrossOrigin = () => (base ? 'anonymous' : undefined)

// A video has a portrait ("m") version once its entry carries `mobile` (seconds per language, set when it is published).
// Until then phones fall back to the widescreen file, so videos can be published in batches.
export const hasMobileVideo = (video) => Boolean(video?.mobile)
export const videoFile = (video, lang, ext, mobile) => `${video.id}.${lang}.${mobile && hasMobileVideo(video) ? 'm.' : ''}${ext}`
export const videoSeconds = (video, lang, mobile) => (mobile && hasMobileVideo(video) ? video.mobile[lang] || video.mobile.en : video.seconds?.[lang] || video.seconds?.en) || 0
