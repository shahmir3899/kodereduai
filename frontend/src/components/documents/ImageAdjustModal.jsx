import { useEffect, useRef, useState } from 'react'
import ReactCrop from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import Modal from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { getCroppedImageFile, getRotatedImageFile } from '../../utils/imageTransform'

const FULL = { unit: '%', x: 0, y: 0, width: 100, height: 100 }

/**
 * Rotate and crop one photo before it is uploaded. Same tools as the Curriculum
 * table-of-contents capture (react-image-crop + utils/imageTransform). Each turn is
 * applied to the file straight away, so the crop box always sits on what will be sent.
 */
export default function ImageAdjustModal({ file, onCancel, onDone }) {
  const [working, setWorking] = useState(file)
  const [preview, setPreview] = useState('')
  const [crop, setCrop] = useState(FULL)
  const [percentCrop, setPercentCrop] = useState(FULL)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef(null)

  useEffect(() => {
    const url = URL.createObjectURL(working)
    setPreview(url)
    setCrop(FULL)
    setPercentCrop(FULL)
    return () => URL.revokeObjectURL(url)
  }, [working])

  const turn = async (degrees) => {
    setBusy(true)
    try {
      setWorking(await getRotatedImageFile(working, degrees))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    const img = imgRef.current
    const c = percentCrop
    const whole = !c || !c.width || !c.height || (c.width >= 99.5 && c.height >= 99.5)
    if (whole || !img) return onDone(working)
    setBusy(true)
    try {
      onDone(await getCroppedImageFile(working, {
        x: (c.x / 100) * img.naturalWidth,
        y: (c.y / 100) * img.naturalHeight,
        width: (c.width / 100) * img.naturalWidth,
        height: (c.height / 100) * img.naturalHeight,
      }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title="Adjust image"
      size="2xl"
      layer="top"
      closeOnBackdrop={false}
      footer={(
        <>
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="button" onClick={finish} disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">Use this image</button>
        </>
      )}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" onClick={() => turn(-90)} disabled={busy} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Rotate left</button>
        <button type="button" onClick={() => turn(90)} disabled={busy} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Rotate right</button>
        <button type="button" onClick={() => { setCrop(FULL); setPercentCrop(FULL) }} disabled={busy} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Reset crop</button>
        {busy && <Spinner size="sm" />}
      </div>
      <p className="text-xs text-gray-500 mb-2">Drag the corners so only the document is inside the box.</p>
      <div className="flex justify-center bg-gray-50 rounded-lg border border-gray-200 py-2">
        {preview && (
          <ReactCrop
            crop={crop}
            onChange={(_, percent) => setCrop(percent)}
            onComplete={(_, percent) => setPercentCrop(percent)}
            minWidth={20}
            minHeight={20}
            ruleOfThirds
          >
            <img ref={imgRef} src={preview} alt="Document to adjust" className="max-h-[60vh] w-auto object-contain block" />
          </ReactCrop>
        )}
      </div>
    </Modal>
  )
}
