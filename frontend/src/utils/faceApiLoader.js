import * as faceapi from 'face-api.js'

// Model weights are self-hosted under public/models/ (copied from the
// official face-api.js weights repo: tiny_face_detector, face_landmark_68,
// face_recognition — the ResNet identity model), not a third-party CDN, so
// availability doesn't depend on a service we don't control. ~6MB+ total
// (design doc §9.2) — loadFaceApiModels() memoizes the
// loading promise so remounting the capture/enrollment page within the same
// browser session doesn't re-trigger the download; persisting across full
// page reloads depends on the static host's Cache-Control headers for
// /models/*, which is outside the frontend build's control.
const MODEL_URL = '/models'

export const LIVE_MOBILE_EMBEDDING_VERSION = 'faceapi_v1'

let modelsPromise = null

export function loadFaceApiModels() {
  if (!modelsPromise) {
    modelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).catch((err) => {
      // Allow a retry (e.g. after a flaky network) instead of caching a
      // permanently-rejected promise for the rest of the session.
      modelsPromise = null
      throw err
    })
  }
  return modelsPromise
}

export function areFaceApiModelsLoaded() {
  return Boolean(
    faceapi.nets.tinyFaceDetector.isLoaded
    && faceapi.nets.faceLandmark68Net.isLoaded
    && faceapi.nets.faceRecognitionNet.isLoaded
  )
}

/**
 * Detect exactly one face in a video/image element and return its 128-d
 * descriptor + detection box, or null if no face (or more than one — the
 * caller should treat "more than one" as "keep waiting", not an error,
 * since a live feed naturally has frames with zero or multiple faces).
 */
export async function detectSingleFace(mediaElement) {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
  const result = await faceapi
    .detectSingleFace(mediaElement, options)
    .withFaceLandmarks()
    .withFaceDescriptor()
  return result || null
}

/**
 * 0-1 heuristic combining detector confidence and face-size-relative-to-frame,
 * mirroring the size/blur-style intent of the server-side quality_score used
 * by the legacy dlib enrollment path (design doc §5).
 */
export function estimateQualityScore(detection, mediaElement) {
  const { box, score } = detection.detection
  const frameWidth = mediaElement.videoWidth || mediaElement.width || 1
  const frameHeight = mediaElement.videoHeight || mediaElement.height || 1
  const sizeRatio = (box.width * box.height) / (frameWidth * frameHeight)
  const sizeScore = Math.min(1, sizeRatio * 6)
  return Math.max(0, Math.min(1, (sizeScore + score) / 2))
}
