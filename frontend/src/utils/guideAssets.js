// Where guide videos, posters and captions are fetched from. Empty means the same site (the signed-in app);
// the public guide on the marketing site points this at the app's host so the videos are stored only once.
let base = ''

export const setVideoBase = (url) => { base = (url || '').replace(/\/$/, '') }

export const videoUrl = (file) => `${base}/videos/${file}`

// Captions loaded from another origin are only readable when the media request is made with CORS.
export const videoCrossOrigin = () => (base ? 'anonymous' : undefined)
