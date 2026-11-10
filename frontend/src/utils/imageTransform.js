// Canvas helpers for fixing a photo before upload. Moved out of CurriculumPage (the
// table-of-contents capture) so document capture can use the same rotate/crop code.

export const readFileAsDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const createImageElement = (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

const toJpegFile = async (canvas, name) => {
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  })
  return new File([blob], name.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export const getRotatedImageFile = async (file, rotation) => {
  if (!rotation) return file

  const imageUrl = await readFileAsDataUrl(file)
  const img = await createImageElement(imageUrl)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const normalizedRotation = ((rotation % 360) + 360) % 360

  if (normalizedRotation === 90 || normalizedRotation === 270) {
    canvas.width = img.height
    canvas.height = img.width
  } else {
    canvas.width = img.width
    canvas.height = img.height
  }

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((normalizedRotation * Math.PI) / 180)
  ctx.drawImage(img, -img.width / 2, -img.height / 2)

  return toJpegFile(canvas, file.name)
}

/** Cut a rectangle (in the image's own pixels) out of a file. */
export const getCroppedImageFile = async (file, pixelCrop) => {
  const img = await createImageElement(await readFileAsDataUrl(file))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(pixelCrop.width))
  canvas.height = Math.max(1, Math.round(pixelCrop.height))
  canvas.getContext('2d').drawImage(
    img, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, canvas.width, canvas.height,
  )
  return toJpegFile(canvas, file.name)
}
