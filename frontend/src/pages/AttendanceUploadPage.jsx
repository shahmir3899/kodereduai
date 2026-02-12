import { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import Compressor from 'compressorjs'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { attendanceApi, classesApi } from '../services/api'

// Compress image before upload - keeps quality high enough for OCR
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    new Compressor(file, {
      quality: 0.8,
      maxWidth: 2000,
      maxHeight: 2000,
      mimeType: 'image/jpeg',
      success(result) {
        const compressed = new File([result], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
        console.log(`Compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressed.size / 1024).toFixed(0)}KB`)
        resolve(compressed)
      },
      error: reject,
    })
  })
}

// AI Status Badge Component
function AIStatusBadge({ status }) {
  if (!status) return null

  const { ai_available, provider_name, model, status: configStatus } = status

  if (!ai_available) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
        <span className="text-sm text-red-700">
          AI Not Configured
          {configStatus === 'missing_credentials' && ' (API key missing)'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
      <div className="text-sm">
        <span className="text-green-700 font-medium">{provider_name}</span>
        {model && (
          <span className="text-green-600 ml-1">({model})</span>
        )}
      </div>
    </div>
  )
}

export default function AttendanceUploadPage() {
  const { user, activeSchool } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedClass, setSelectedClass] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [uploadedFiles, setUploadedFiles] = useState([]) // Array of {file, previewUrl, rotation}
  const [error, setError] = useState('')
  const [uploadStep, setUploadStep] = useState(null)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })
  const [cropModalIndex, setCropModalIndex] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  // Fetch classes
  const { data: classesData } = useQuery({
    queryKey: ['classes', activeSchool?.id],
    queryFn: () => classesApi.getClasses({ school_id: activeSchool?.id }),
    enabled: !!activeSchool?.id,
  })

  // Fetch AI status
  const { data: aiStatusData } = useQuery({
    queryKey: ['aiStatus'],
    queryFn: () => attendanceApi.getAIStatus(),
    staleTime: 60000, // Cache for 1 minute
  })
  const aiStatus = aiStatusData?.data

  // Create attendance record mutation
  const createMutation = useMutation({
    mutationFn: (data) => attendanceApi.createUpload(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['pendingReviews'])
      setUploadStep(null)
      const uploadId = response.data?.id
      if (uploadId) {
        navigate(`/attendance/review/${uploadId}`)
      } else {
        console.error('No upload ID in response:', response.data)
        setError('Upload created but could not navigate to review page')
      }
    },
    onError: (err) => {
      setUploadStep(null)
      const errorMsg = err.response?.data?.non_field_errors?.[0]
        || err.response?.data?.error
        || err.response?.data?.date?.[0]
        || 'Failed to create attendance record'
      setError(errorMsg)
    },
  })

  // Handle file drop - supports multiple files
  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      rotation: 0
    }))
    setUploadedFiles(prev => [...prev, ...newFiles])
    setError('')
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp'],
    },
    maxSize: 10 * 1024 * 1024,
    // Allow multiple files for multi-page registers
  })

  // Rotate image using canvas and return as blob
  const getRotatedImageBlob = (fileObj) => {
    return new Promise((resolve) => {
      if (fileObj.rotation === 0) {
        resolve(fileObj.file)
        return
      }

      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        // Swap width/height for 90 or 270 degree rotation
        if (fileObj.rotation === 90 || fileObj.rotation === 270) {
          canvas.width = img.height
          canvas.height = img.width
        } else {
          canvas.width = img.width
          canvas.height = img.height
        }

        // Move to center, rotate, then draw
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate((fileObj.rotation * Math.PI) / 180)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)

        canvas.toBlob((blob) => {
          const rotatedFile = new File([blob], fileObj.file.name, {
            type: fileObj.file.type || 'image/jpeg',
          })
          resolve(rotatedFile)
        }, fileObj.file.type || 'image/jpeg', 0.9)
      }
      img.src = fileObj.previewUrl
    })
  }

  // Crop image using canvas and return as blob
  const getCroppedImageBlob = async (imageSrc, pixelCrop, rotation = 0) => {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.addEventListener('load', () => resolve(img))
      img.addEventListener('error', reject)
      img.src = imageSrc
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const rotRad = (rotation * Math.PI) / 180

    // Calculate bounding box of rotated image
    const sin = Math.abs(Math.sin(rotRad))
    const cos = Math.abs(Math.cos(rotRad))
    const bBoxWidth = image.width * cos + image.height * sin
    const bBoxHeight = image.width * sin + image.height * cos

    // Draw rotated image to canvas
    canvas.width = bBoxWidth
    canvas.height = bBoxHeight
    ctx.translate(bBoxWidth / 2, bBoxHeight / 2)
    ctx.rotate(rotRad)
    ctx.translate(-image.width / 2, -image.height / 2)
    ctx.drawImage(image, 0, 0)

    // Extract cropped pixels
    const croppedData = ctx.getImageData(
      pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height
    )
    canvas.width = pixelCrop.width
    canvas.height = pixelCrop.height
    ctx.putImageData(croppedData, 0, 0)

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
    })
  }

  const onCropComplete = useCallback((croppedArea, croppedAreaPx) => {
    setCroppedAreaPixels(croppedAreaPx)
  }, [])

  const handleCropSave = async () => {
    if (cropModalIndex === null || !croppedAreaPixels) return

    const fileObj = uploadedFiles[cropModalIndex]
    const croppedBlob = await getCroppedImageBlob(
      fileObj.previewUrl, croppedAreaPixels, fileObj.rotation
    )
    const croppedFile = new File([croppedBlob], fileObj.file.name, { type: 'image/jpeg' })

    URL.revokeObjectURL(fileObj.previewUrl)
    const newPreviewUrl = URL.createObjectURL(croppedFile)

    setUploadedFiles(prev => prev.map((f, i) =>
      i === cropModalIndex
        ? { file: croppedFile, previewUrl: newPreviewUrl, rotation: 0 }
        : f
    ))
    setCropModalIndex(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
  }

  // Handle upload
  const handleUpload = async () => {
    if (!selectedClass || !selectedDate || uploadedFiles.length === 0) {
      setError('Please select a class, date, and upload at least one image')
      return
    }

    setError('')
    setUploadStep('uploading')
    setUploadProgress({ current: 0, total: uploadedFiles.length })

    try {
      const imageUrls = []

      // Upload each image
      for (let i = 0; i < uploadedFiles.length; i++) {
        setUploadProgress({ current: i + 1, total: uploadedFiles.length })

        const rotatedFile = await getRotatedImageBlob(uploadedFiles[i])
        const fileToUpload = await compressImage(rotatedFile)
        const uploadResponse = await attendanceApi.uploadImageToStorage(
          fileToUpload,
          activeSchool?.id,
          selectedClass
        )
        imageUrls.push(uploadResponse.data.url)
        console.log(`Image ${i + 1} uploaded to:`, uploadResponse.data.url)
      }

      // Create attendance record
      setUploadStep('creating')

      const createData = {
        school: activeSchool?.id,
        class_obj: parseInt(selectedClass),
        date: selectedDate,
      }

      // Use image_urls for multi-page, image_url for single
      if (imageUrls.length === 1) {
        createData.image_url = imageUrls[0]
      } else {
        createData.image_urls = imageUrls
      }

      createMutation.mutate(createData)
    } catch (err) {
      console.error('Upload error:', err)
      setUploadStep(null)
      setError(err.response?.data?.error || 'Failed to upload image to storage')
    }
  }

  // Rotation handlers
  const rotateImage = (index, direction) => {
    setUploadedFiles(prev => prev.map((f, i) => {
      if (i === index) {
        const newRotation = direction === 'left'
          ? (f.rotation - 90 + 360) % 360
          : (f.rotation + 90) % 360
        return { ...f, rotation: newRotation }
      }
      return f
    }))
  }

  // Remove a file
  const removeFile = (index) => {
    setUploadedFiles(prev => {
      const newFiles = prev.filter((_, i) => i !== index)
      // Revoke URL to prevent memory leak
      URL.revokeObjectURL(prev[index].previewUrl)
      return newFiles
    })
  }

  // Move file up/down in order
  const moveFile = (index, direction) => {
    setUploadedFiles(prev => {
      const newFiles = [...prev]
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex >= 0 && newIndex < newFiles.length) {
        [newFiles[index], newFiles[newIndex]] = [newFiles[newIndex], newFiles[index]]
      }
      return newFiles
    })
  }

  // Clear all files
  const clearAllFiles = () => {
    uploadedFiles.forEach(f => URL.revokeObjectURL(f.previewUrl))
    setUploadedFiles([])
  }

  // Get loading message based on step
  const getLoadingMessage = () => {
    switch (uploadStep) {
      case 'uploading':
        return `Uploading image ${uploadProgress.current} of ${uploadProgress.total}...`
      case 'creating':
        return 'Creating attendance record...'
      case 'processing':
        return 'Processing with AI (this may take a moment)...'
      default:
        return 'Processing...'
    }
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Upload Attendance</h1>
            <p className="text-sm sm:text-base text-gray-600">Upload photo(s) of your attendance register for AI processing</p>
          </div>
          <AIStatusBadge status={aiStatus} />
        </div>
      </div>

      <div className="max-w-3xl">
        <div className="card mb-6">
          {/* Class & Date Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="label">Class</label>
              <select
                className="input"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
              >
                <option value="">Select a class</option>
                {classesData?.data?.results?.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-4 sm:p-6 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
            }`}
          >
            <input {...getInputProps()} />
            <svg
              className="mx-auto h-10 w-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="mt-3 text-sm sm:text-base text-gray-600">
              {isDragActive
                ? 'Drop the image(s) here...'
                : <>
                    <span className="sm:hidden">Tap to select attendance register photos</span>
                    <span className="hidden sm:inline">Drag & drop attendance register image(s), or click to select</span>
                  </>
              }
            </p>
            <p className="mt-1 text-xs sm:text-sm text-gray-500">
              PNG, JPG, WEBP up to 10MB each.
              <span className="text-primary-600 font-medium"> Upload multiple images for multi-page registers.</span>
            </p>
          </div>

          {/* Camera Capture Button */}
          <div className="mt-3">
            <label className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-primary-600 text-white rounded-xl font-medium cursor-pointer hover:bg-primary-700 active:bg-primary-800 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="sm:hidden">Take Photo</span>
              <span className="hidden sm:inline">Capture / Select Photo</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files)
                  if (files.length > 0) {
                    const newFiles = files.map(file => ({
                      file,
                      previewUrl: URL.createObjectURL(file),
                      rotation: 0
                    }))
                    setUploadedFiles(prev => [...prev, ...newFiles])
                    setError('')
                  }
                  e.target.value = ''
                }}
              />
            </label>
            <p className="text-xs text-center text-gray-500 mt-1">
              <span className="sm:hidden">Opens your device camera directly</span>
              <span className="hidden sm:inline">Opens camera on mobile, or file picker on desktop</span>
            </p>
          </div>

          {/* Uploaded Files Preview */}
          {uploadedFiles.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-gray-900">
                  {uploadedFiles.length} Page{uploadedFiles.length > 1 ? 's' : ''} Selected
                </h3>
                <button
                  onClick={clearAllFiles}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-4">
                {uploadedFiles.map((fileObj, index) => (
                  <div
                    key={index}
                    className="relative border border-gray-200 rounded-lg p-3 bg-gray-50"
                  >
                    <div className="flex items-start gap-2 sm:gap-4">
                      {/* Page Number */}
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-gray-500">Page</span>
                        <span className="w-8 h-8 flex items-center justify-center bg-primary-100 text-primary-700 rounded-full font-medium">
                          {index + 1}
                        </span>
                        {/* Move controls */}
                        <div className="flex flex-col gap-1 mt-1">
                          <button
                            onClick={() => moveFile(index, 'up')}
                            disabled={index === 0}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            title="Move up"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => moveFile(index, 'down')}
                            disabled={index === uploadedFiles.length - 1}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            title="Move down"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Image Preview */}
                      <div className="flex-1">
                        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white max-h-48">
                          <img
                            src={fileObj.previewUrl}
                            alt={`Page ${index + 1}`}
                            className="w-full h-auto object-contain max-h-48 transition-transform duration-200"
                            style={{ transform: `rotate(${fileObj.rotation}deg)` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">{fileObj.file.name}</p>
                      </div>

                      {/* Controls */}
                      <div className="flex flex-col gap-2">
                        {/* Rotation */}
                        <div className="flex gap-1">
                          <button
                            onClick={() => rotateImage(index, 'left')}
                            className="p-2.5 sm:p-2 bg-white border border-gray-200 rounded hover:bg-gray-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                            title="Rotate left"
                          >
                            <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          </button>
                          <button
                            onClick={() => rotateImage(index, 'right')}
                            className="p-2.5 sm:p-2 bg-white border border-gray-200 rounded hover:bg-gray-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                            title="Rotate right"
                          >
                            <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                            </svg>
                          </button>
                        </div>
                        {fileObj.rotation !== 0 && (
                          <span className="text-xs text-center text-blue-600">{fileObj.rotation}°</span>
                        )}
                        {/* Crop */}
                        <button
                          onClick={() => {
                            setCropModalIndex(index)
                            setCrop({ x: 0, y: 0 })
                            setZoom(1)
                            setCroppedAreaPixels(null)
                          }}
                          className="p-2.5 sm:p-2 bg-white border border-gray-200 rounded hover:bg-gray-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Crop image"
                        >
                          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v4m0 0H3m4 0h10a2 2 0 012 2v10m0 0v4m0-4h4m-4 0H7a2 2 0 01-2-2V7" />
                          </svg>
                        </button>
                        {/* Remove */}
                        <button
                          onClick={() => removeFile(index)}
                          className="p-2.5 sm:p-2 bg-red-50 border border-red-200 rounded hover:bg-red-100 text-red-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Remove"
                        >
                          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Upload Button */}
              <div className="mt-6">
                <button
                  onClick={handleUpload}
                  disabled={uploadStep !== null || createMutation.isPending || !selectedClass || !selectedDate}
                  className="w-full btn btn-primary py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadStep || createMutation.isPending ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {getLoadingMessage()}
                    </span>
                  ) : (
                    `Upload ${uploadedFiles.length} Page${uploadedFiles.length > 1 ? 's' : ''} & Process with AI`
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <details className="card bg-blue-50 border-blue-200 group" open>
          <summary className="font-medium text-blue-800 cursor-pointer list-none flex items-center justify-between">
            Tips for best results
            <svg className="w-4 h-4 sm:hidden transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <ul className="text-sm text-blue-700 space-y-1 mt-2">
            <li>- <strong>Multi-page registers:</strong> Upload all pages - they'll be processed and merged automatically</li>
            <li>- Use rotation buttons to orient each page correctly (text should be horizontal)</li>
            <li>- Use page order buttons to ensure pages are in the correct sequence</li>
            <li>- Ensure each image is clear and well-lit</li>
            <li>- Capture the entire page with all student names visible</li>
            <li>- Make sure attendance marks (P/A/checkmarks) are clearly visible</li>
          </ul>
        </details>
      </div>

      {/* Crop Modal */}
      {cropModalIndex !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black bg-opacity-75">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-white border-b">
            <h3 className="text-lg font-semibold text-gray-900">Crop Image</h3>
            <button
              onClick={() => {
                setCropModalIndex(null)
                setCrop({ x: 0, y: 0 })
                setZoom(1)
              }}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Cropper Area */}
          <div className="relative flex-1">
            <Cropper
              image={uploadedFiles[cropModalIndex]?.previewUrl}
              crop={crop}
              zoom={zoom}
              rotation={uploadedFiles[cropModalIndex]?.rotation || 0}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>

          {/* Controls */}
          <div className="bg-white border-t p-4">
            <div className="flex items-center gap-3 mb-4 max-w-md mx-auto">
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
              </svg>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
              />
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
              </svg>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setCropModalIndex(null)
                  setCrop({ x: 0, y: 0 })
                  setZoom(1)
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCropSave}
                className="btn btn-primary"
              >
                Save Crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
