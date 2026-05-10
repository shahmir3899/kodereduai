import Compressor from 'compressorjs'

/** Defaults aligned with attendance OCR uploads — JPEG strips most EXIF; size helps mobile uplink. */
const DEFAULTS = {
  quality: 0.8,
  maxWidth: 2000,
  maxHeight: 2000,
  mimeType: 'image/jpeg',
}

/**
 * Resize/re-encode an image for multipart upload (smaller payload, metadata stripped via re-encode).
 * @param {File|Blob} file
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {Promise<File>}
 */
export function compressImageForUpload(file, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  return new Promise((resolve, reject) => {
    new Compressor(file, {
      quality: opts.quality,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      mimeType: opts.mimeType,
      success(result) {
        const baseName = (file.name || 'image').replace(/\.[^/.]+$/, '.jpg')
        resolve(new File([result], baseName, { type: 'image/jpeg' }))
      },
      error: reject,
    })
  })
}

/** Smaller payload for TOC OCR — mobile uplink + async job DB payload are sensitive to size. */
export function compressImageForTocOcr(file) {
  return compressImageForUpload(file, {
    quality: 0.76,
    maxWidth: 1800,
    maxHeight: 1800,
    mimeType: 'image/jpeg',
  })
}
