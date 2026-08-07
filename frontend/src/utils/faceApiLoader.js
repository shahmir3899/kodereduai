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

/**
 * Cheap "how many faces are in frame" check — box-only detection, no
 * landmarks/descriptor pass, since callers that need this (multi-face
 * rejection during enrollment, pre-submit face count on a group photo) only
 * care about the count/positions, not identity.
 */
export async function detectAllFacesQuick(mediaElement) {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
  return faceapi.detectAllFaces(mediaElement, options)
}

// How much of the frame a well-framed face should occupy, and how far its
// center may drift from the frame center, before we nudge the operator.
// Shared between Live Mobile Capture (attendance) and Live Capture
// (enrollment) so "move closer" / "center your face" mean the same thing —
// tolerance-wise — in both places.
const MIN_FACE_SIZE_RATIO = 0.12
const CENTER_TOLERANCE_RATIO = 0.18

/**
 * Given a single face-api.js detection box (in mediaElement's intrinsic
 * pixel space) and the media element it came from, returns a framing
 * verdict: 'too-small' (move closer), 'off-center', or 'good'.
 */
export function getFramingHint(box, mediaElement) {
  const frameWidth = mediaElement.videoWidth || mediaElement.width || 1
  const frameHeight = mediaElement.videoHeight || mediaElement.height || 1
  const sizeRatio = (box.width * box.height) / (frameWidth * frameHeight)
  if (sizeRatio < MIN_FACE_SIZE_RATIO) {
    return { status: 'too-small', message: 'Move closer' }
  }
  const boxCenterX = box.x + box.width / 2
  const boxCenterY = box.y + box.height / 2
  const dx = Math.abs(boxCenterX - frameWidth / 2) / frameWidth
  const dy = Math.abs(boxCenterY - frameHeight / 2) / frameHeight
  if (dx > CENTER_TOLERANCE_RATIO || dy > CENTER_TOLERANCE_RATIO) {
    return { status: 'off-center', message: 'Center your face' }
  }
  return { status: 'good', message: null }
}
