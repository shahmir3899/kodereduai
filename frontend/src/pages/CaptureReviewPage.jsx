import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import Cropper from 'react-easy-crop'
import Compressor from 'compressorjs'
import { useDropzone } from 'react-dropzone'
import { useAuth } from '../contexts/AuthContext'
import { attendanceApi, classesApi, studentsApi } from '../services/api'

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

// ─── Image Alignment Guide ───
function ImageAlignmentGuide({ width, height }) {
  const colWidth = width / 3
  return (
    <svg
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      {/* Vertical column guides - 3 columns: Roll#, Name, Attendance */}
      <line x1={colWidth} y1="0" x2={colWidth} y2={height} stroke="rgba(59, 130, 246, 0.4)" strokeWidth="2" strokeDasharray="5,5" />
      <line x1={colWidth * 2} y1="0" x2={colWidth * 2} y2={height} stroke="rgba(59, 130, 246, 0.4)" strokeWidth="2" strokeDasharray="5,5" />
      
      {/* Horizontal baseline guides */}
      <line x1="0" y1={height * 0.1} x2={width} y2={height * 0.1} stroke="rgba(34, 197, 94, 0.3)" strokeWidth="1" strokeDasharray="3,3" />
      <line x1="0" y1={height * 0.9} x2={width} y2={height * 0.9} stroke="rgba(34, 197, 94, 0.3)" strokeWidth="1" strokeDasharray="3,3" />
      
      {/* Column labels */}
      <text x={colWidth * 0.5} y="20" textAnchor="middle" fill="rgba(59, 130, 246, 0.6)" fontSize="12" fontWeight="bold">Roll #</text>
      <text x={colWidth * 1.5} y="20" textAnchor="middle" fill="rgba(59, 130, 246, 0.6)" fontSize="12" fontWeight="bold">Name</text>
      <text x={colWidth * 2.5} y="20" textAnchor="middle" fill="rgba(59, 130, 246, 0.6)" fontSize="12" fontWeight="bold">Attendance (Days 1-15)</text>
      
      {/* Top alignment indicator */}
      <rect x="0" y="0" width={width} height="3" fill="rgba(34, 197, 94, 0.5)" />
    </svg>
  )
}

// ─── Tab button ───
function TabButton({ active, onClick, children, badge }) {
  return (
    <button
      onClick={onClick}
      className={`py-3 px-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
        active
          ? 'border-primary-600 text-primary-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
      {badge > 0 && (
        <span className="bg-yellow-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{badge}</span>
      )}
    </button>
  )
}

// ─── AI Status Badge ───
function AIStatusBadge({ status }) {
  if (!status) return null
  const { ai_available, provider_name, model, status: configStatus } = status
  if (!ai_available) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
        <span className="text-sm text-red-700">AI Not Configured{configStatus === 'missing_credentials' && ' (API key missing)'}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
      <div className="text-sm">
        <span className="text-green-700 font-medium">{provider_name}</span>
        {model && <span className="text-green-600 ml-1">({model})</span>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// UPLOAD TAB
// ═══════════════════════════════════════════
function UploadTab({ onUploadSuccess }) {
  const { user, activeSchool } = useAuth()
  const queryClient = useQueryClient()

  const [selectedClass, setSelectedClass] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [error, setError] = useState('')
  const [uploadStep, setUploadStep] = useState(null)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })
  const [cropModalIndex, setCropModalIndex] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  const { data: classesData } = useQuery({
    queryKey: ['classes', activeSchool?.id],
    queryFn: () => classesApi.getClasses({ school_id: activeSchool?.id, page_size: 9999 }),
    enabled: !!activeSchool?.id,
  })

  const { data: aiStatusData } = useQuery({
    queryKey: ['aiStatus'],
    queryFn: () => attendanceApi.getAIStatus(),
    staleTime: 60000,
  })

  const createMutation = useMutation({
    mutationFn: data => attendanceApi.createUpload(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['pendingReviews'] })
      setUploadStep(null)
      setUploadedFiles([])
      const uploadId = response.data?.id
      if (uploadId) {
        onUploadSuccess(uploadId)
      } else {
        setError('Upload created but could not navigate to review')
      }
    },
    onError: (err) => {
      setUploadStep(null)
      setError(err.response?.data?.non_field_errors?.[0] || err.response?.data?.error || err.response?.data?.date?.[0] || 'Failed to create attendance record')
    },
  })

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({ file, previewUrl: URL.createObjectURL(file), rotation: 0 }))
    setUploadedFiles(prev => [...prev, ...newFiles])
    setError('')
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    maxSize: 10 * 1024 * 1024,
  })

  const getRotatedImageBlob = (fileObj) => {
    return new Promise((resolve) => {
      if (fileObj.rotation === 0) { resolve(fileObj.file); return }
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (fileObj.rotation === 90 || fileObj.rotation === 270) { canvas.width = img.height; canvas.height = img.width }
        else { canvas.width = img.width; canvas.height = img.height }
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate((fileObj.rotation * Math.PI) / 180)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        canvas.toBlob(blob => {
          resolve(new File([blob], fileObj.file.name, { type: fileObj.file.type || 'image/jpeg' }))
        }, fileObj.file.type || 'image/jpeg', 0.9)
      }
      img.src = fileObj.previewUrl
    })
  }

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
    const sin = Math.abs(Math.sin(rotRad)), cos = Math.abs(Math.cos(rotRad))
    const bBoxWidth = image.width * cos + image.height * sin
    const bBoxHeight = image.width * sin + image.height * cos
    canvas.width = bBoxWidth; canvas.height = bBoxHeight
    ctx.translate(bBoxWidth / 2, bBoxHeight / 2)
    ctx.rotate(rotRad)
    ctx.translate(-image.width / 2, -image.height / 2)
    ctx.drawImage(image, 0, 0)
    const croppedData = ctx.getImageData(pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height)
    canvas.width = pixelCrop.width; canvas.height = pixelCrop.height
    ctx.putImageData(croppedData, 0, 0)
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92))
  }

  const onCropComplete = useCallback((_, croppedAreaPx) => setCroppedAreaPixels(croppedAreaPx), [])

  const handleCropSave = async () => {
    if (cropModalIndex === null || !croppedAreaPixels) return
    const fileObj = uploadedFiles[cropModalIndex]
    const croppedBlob = await getCroppedImageBlob(fileObj.previewUrl, croppedAreaPixels, fileObj.rotation)
    const croppedFile = new File([croppedBlob], fileObj.file.name, { type: 'image/jpeg' })
    URL.revokeObjectURL(fileObj.previewUrl)
    const newPreviewUrl = URL.createObjectURL(croppedFile)
    setUploadedFiles(prev => prev.map((f, i) => i === cropModalIndex ? { file: croppedFile, previewUrl: newPreviewUrl, rotation: 0 } : f))
    setCropModalIndex(null); setCrop({ x: 0, y: 0 }); setZoom(1); setCroppedAreaPixels(null)
  }

  const handleUpload = async () => {
    if (!selectedClass || !selectedDate || uploadedFiles.length === 0) {
      setError('Please select a class, date, and upload at least one image'); return
    }
    setError(''); setUploadStep('uploading'); setUploadProgress({ current: 0, total: uploadedFiles.length })
    try {
      const imageUrls = []
      for (let i = 0; i < uploadedFiles.length; i++) {
        setUploadProgress({ current: i + 1, total: uploadedFiles.length })
        const rotatedFile = await getRotatedImageBlob(uploadedFiles[i])
        const fileToUpload = await compressImage(rotatedFile)
        const uploadResponse = await attendanceApi.uploadImageToStorage(fileToUpload, activeSchool?.id, selectedClass)
        imageUrls.push(uploadResponse.data.url)
      }
      setUploadStep('creating')
      const createData = { school: activeSchool?.id, class_obj: parseInt(selectedClass), date: selectedDate }
      if (imageUrls.length === 1) createData.image_url = imageUrls[0]
      else createData.image_urls = imageUrls
      createMutation.mutate(createData)
    } catch (err) {
      setUploadStep(null)
      setError(err.response?.data?.error || 'Failed to upload image to storage')
    }
  }

  const rotateImage = (index, direction) => {
    setUploadedFiles(prev => prev.map((f, i) => i === index ? { ...f, rotation: direction === 'left' ? (f.rotation - 90 + 360) % 360 : (f.rotation + 90) % 360 } : f))
  }
  const removeFile = (index) => { setUploadedFiles(prev => { URL.revokeObjectURL(prev[index].previewUrl); return prev.filter((_, i) => i !== index) }) }
  const moveFile = (index, direction) => {
    setUploadedFiles(prev => {
      const f = [...prev]; const ni = direction === 'up' ? index - 1 : index + 1
      if (ni >= 0 && ni < f.length) { [f[index], f[ni]] = [f[ni], f[index]] }
      return f
    })
  }
  const clearAllFiles = () => { uploadedFiles.forEach(f => URL.revokeObjectURL(f.previewUrl)); setUploadedFiles([]) }
  const getLoadingMessage = () => {
    if (uploadStep === 'uploading') return `Uploading image ${uploadProgress.current} of ${uploadProgress.total}...`
    if (uploadStep === 'creating') return 'Creating attendance record...'
    return 'Processing...'
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <p className="text-sm text-gray-600">Upload photo(s) of your attendance register for AI processing</p>
        <AIStatusBadge status={aiStatusData?.data} />
      </div>

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="label">Class</label>
            <select className="input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
              <option value="">Select a class</option>
              {(classesData?.data?.results || classesData?.data || []).map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        {/* Dropzone */}
        <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-4 sm:p-6 text-center cursor-pointer transition-colors ${isDragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'}`}>
          <input {...getInputProps()} />
          <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <p className="mt-3 text-sm sm:text-base text-gray-600">
            {isDragActive ? 'Drop the image(s) here...' : <><span className="sm:hidden">Tap to select attendance register photos</span><span className="hidden sm:inline">Drag & drop attendance register image(s), or click to select</span></>}
          </p>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">PNG, JPG, WEBP up to 10MB each. <span className="text-primary-600 font-medium">Upload multiple for multi-page registers.</span></p>
        </div>

        {/* Camera Button */}
        <div className="mt-3">
          <label className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-primary-600 text-white rounded-xl font-medium cursor-pointer hover:bg-primary-700 active:bg-primary-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="sm:hidden">Take Photo</span><span className="hidden sm:inline">Capture / Select Photo</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
              const files = Array.from(e.target.files)
              if (files.length > 0) { setUploadedFiles(prev => [...prev, ...files.map(file => ({ file, previewUrl: URL.createObjectURL(file), rotation: 0 }))]); setError('') }
              e.target.value = ''
            }} />
          </label>
        </div>

        {/* Files Preview */}
        {uploadedFiles.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">{uploadedFiles.length} Page{uploadedFiles.length > 1 ? 's' : ''} Selected</h3>
              <button onClick={clearAllFiles} className="text-sm text-red-600 hover:text-red-700">Clear All</button>
            </div>
            <div className="space-y-4">
              {uploadedFiles.map((fileObj, index) => (
                <div key={index} className="relative border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-start gap-2 sm:gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs text-gray-500">Page</span>
                      <span className="w-8 h-8 flex items-center justify-center bg-primary-100 text-primary-700 rounded-full font-medium">{index + 1}</span>
                      <div className="flex flex-col gap-1 mt-1">
                        <button onClick={() => moveFile(index, 'up')} disabled={index === 0} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="Move up"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg></button>
                        <button onClick={() => moveFile(index, 'down')} disabled={index === uploadedFiles.length - 1} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="Move down"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white max-h-48">
                        <img src={fileObj.previewUrl} alt={`Page ${index + 1}`} className="w-full h-auto object-contain max-h-48 transition-transform duration-200" style={{ transform: `rotate(${fileObj.rotation}deg)` }} />
                        {/* Alignment Grid Overlay */}
                        <div className="absolute inset-0 pointer-events-none">
                          <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                            {/* Vertical column guides - Roll#, Name, Attendance */}
                            <line x1="33.33" y1="0" x2="33.33" y2="100" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.5" strokeDasharray="2,2" />
                            <line x1="66.66" y1="0" x2="66.66" y2="100" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.5" strokeDasharray="2,2" />
                            
                            {/* Multiple horizontal baseline guides for row alignment */}
                            <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(34, 197, 94, 0.5)" strokeWidth="0.6" />
                            <line x1="0" y1="30" x2="100" y2="30" stroke="rgba(34, 197, 94, 0.35)" strokeWidth="0.6" strokeDasharray="1,1" />
                            <line x1="0" y1="45" x2="100" y2="45" stroke="rgba(34, 197, 94, 0.35)" strokeWidth="0.6" strokeDasharray="1,1" />
                            <line x1="0" y1="60" x2="100" y2="60" stroke="rgba(34, 197, 94, 0.35)" strokeWidth="0.6" strokeDasharray="1,1" />
                            <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(34, 197, 94, 0.35)" strokeWidth="0.6" strokeDasharray="1,1" />
                            <line x1="0" y1="90" x2="100" y2="90" stroke="rgba(34, 197, 94, 0.5)" strokeWidth="0.6" />
                            
                            {/* Column headers indicator area */}
                            <rect x="0" y="12" width="33.33" height="5" fill="rgba(59, 130, 246, 0.05)" />
                            <rect x="33.33" y="12" width="33.34" height="5" fill="rgba(59, 130, 246, 0.05)" />
                            <rect x="66.66" y="12" width="33.34" height="5" fill="rgba(59, 130, 246, 0.05)" />
                          </svg>
                          
                          {/* Status indicator */}
                          <div className="absolute bottom-1 right-1 bg-blue-500 bg-opacity-70 text-white px-2 py-0.5 rounded text-xs font-medium">
                            {Math.abs(fileObj.rotation) > 2 ? 'Rotated' : 'Aligned'}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">{fileObj.file.name}</p>
                      <p className="text-xs text-blue-600 mt-0.5">Blue: Columns | Green: Row alignment (thick = header/footer)</p>
                      
                      {/* Fine-grain rotation slider */}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-gray-600 font-medium">Rotate:</span>
                        <input 
                          type="range" 
                          min="-45" 
                          max="45" 
                          value={fileObj.rotation} 
                          onChange={(e) => {
                            const newRotation = parseInt(e.target.value)
                            setUploadedFiles(prev => prev.map((f, i) => i === index ? { ...f, rotation: newRotation } : f))
                          }}
                          className="flex-1 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, #d1d5db 0%, #d1d5db ${50 + (fileObj.rotation / 90) * 50}%, #3b82f6 ${50 + (fileObj.rotation / 90) * 50}%, #3b82f6 100%)`
                          }}
                        />
                        <span className="text-xs font-mono text-primary-600 w-10 text-right">{fileObj.rotation}°</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-1">
                        <button onClick={() => rotateImage(index, 'left')} className="p-2.5 sm:p-2 bg-white border border-gray-200 rounded hover:bg-gray-50 min-w-[40px] min-h-[40px] flex items-center justify-center" title="Rotate left"><svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg></button>
                        <button onClick={() => rotateImage(index, 'right')} className="p-2.5 sm:p-2 bg-white border border-gray-200 rounded hover:bg-gray-50 min-w-[40px] min-h-[40px] flex items-center justify-center" title="Rotate right"><svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg></button>
                      </div>
                      {fileObj.rotation !== 0 && <span className="text-xs text-center text-blue-600">{fileObj.rotation}°</span>}
                      <button onClick={() => { setCropModalIndex(index); setCrop({ x: 0, y: 0 }); setZoom(1); setCroppedAreaPixels(null) }} className="p-2.5 sm:p-2 bg-white border border-gray-200 rounded hover:bg-gray-50 min-w-[40px] min-h-[40px] flex items-center justify-center" title="Crop"><svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v4m0 0H3m4 0h10a2 2 0 012 2v10m0 0v4m0-4h4m-4 0H7a2 2 0 01-2-2V7" /></svg></button>
                      <button onClick={() => removeFile(index)} className="p-2.5 sm:p-2 bg-red-50 border border-red-200 rounded hover:bg-red-100 text-red-600 min-w-[40px] min-h-[40px] flex items-center justify-center" title="Remove"><svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <button onClick={handleUpload} disabled={uploadStep !== null || createMutation.isPending || !selectedClass || !selectedDate} className="w-full btn btn-primary py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed">
                {uploadStep || createMutation.isPending ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    {getLoadingMessage()}
                  </span>
                ) : `Upload ${uploadedFiles.length} Page${uploadedFiles.length > 1 ? 's' : ''} & Process with AI`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tips */}
      <details className="card bg-blue-50 border-blue-200 group">
        <summary className="font-medium text-blue-800 cursor-pointer list-none flex items-center justify-between">
          Tips for best results
          <svg className="w-4 h-4 sm:hidden transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <ul className="text-sm text-blue-700 space-y-2 mt-2">
          <li>- <strong>Fine-grain rotation:</strong> Use the slider below each image preview for precise alignment
            <ul className="text-xs text-blue-600 mt-1 ml-4 space-y-1">
              <li>• Slide left/right to rotate ±45° in small increments</li>
              <li>• Quick toggle buttons still work for 90° rotations</li>
              <li>• Watch the green lines align with student rows as you adjust</li>
            </ul>
          </li>
          <li>- <strong>Alignment guides:</strong> Look for the gridlines overlaid on each image
            <ul className="text-xs text-blue-600 mt-1 ml-4 space-y-1">
              <li>• <strong className="text-blue-700">Blue vertical lines:</strong> Divide Roll#, Name, and Attendance columns</li>
              <li>• <strong className="text-blue-700">Green horizontal lines:</strong> 5 alignment guides for student rows
                <ul className="text-xs text-blue-500 mt-0.5 ml-2">
                  <li>◦ Thick lines (top & bottom): Mark header and footer rows</li>
                  <li>◦ Thin dashed lines: Guide for middle student rows</li>
                </ul>
              </li>
              <li>• Best alignment: Student names and marks should sit on or between green lines</li>
            </ul>
          </li>
          <li>- <strong>Review attendance data:</strong> Check Name/Roll columns for AI match confidence
            <ul className="text-xs text-blue-600 mt-1 ml-4 space-y-1">
              <li>• ✓ (check) = confirm this AI match is correct</li>
              <li>• ✗ (X) = AI matched wrong student, needs correction</li>
              <li>• Use P/A buttons to mark specific students</li>
            </ul>
          </li>
          <li>- <strong>Multi-page registers:</strong> Upload all pages - they'll be processed and merged automatically</li>
          <li>- Ensure each image is clear, well-lit, and shows all student names and attendance marks</li>
        </ul>
      </details>

      {/* Crop Modal */}
      {cropModalIndex !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black bg-opacity-75">
          <div className="flex items-center justify-between p-4 bg-white border-b">
            <h3 className="text-lg font-semibold text-gray-900">Crop Image</h3>
            <button onClick={() => { setCropModalIndex(null); setCrop({ x: 0, y: 0 }); setZoom(1) }} className="p-2 hover:bg-gray-100 rounded-full">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="relative flex-1">
            <Cropper image={uploadedFiles[cropModalIndex]?.previewUrl} crop={crop} zoom={zoom} rotation={uploadedFiles[cropModalIndex]?.rotation || 0} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
          </div>
          <div className="bg-white border-t p-4">
            <div className="flex items-center gap-3 mb-4 max-w-md mx-auto">
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" /></svg>
              <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={e => setZoom(Number(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600" />
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" /></svg>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setCropModalIndex(null); setCrop({ x: 0, y: 0 }); setZoom(1) }} className="btn btn-secondary">Cancel</button>
              <button onClick={handleCropSave} className="btn btn-primary">Save Crop</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// REVIEW DETAIL (inline panel)
// ═══════════════════════════════════════════
function ReviewDetail({ uploadId, onBack }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedAbsent, setSelectedAbsent] = useState(new Set())
  const [nameCorrections, setNameCorrections] = useState({})
  const [rollCorrections, setRollCorrections] = useState({})
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessError, setReprocessError] = useState('')
  const [reprocessSuccess, setReprocessSuccess] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const { data: uploadData, isLoading } = useQuery({
    queryKey: ['uploadDetail', uploadId],
    queryFn: () => attendanceApi.getUploadDetails(uploadId),
    enabled: !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      return status === 'PROCESSING' ? 3000 : false
    },
  })
  const upload = uploadData?.data

  const { data: studentsData } = useQuery({
    queryKey: ['classStudents', upload?.class_obj],
    queryFn: () => studentsApi.getStudents({ class_id: upload?.class_obj, is_active: true, page_size: 9999 }),
    enabled: !!upload?.class_obj,
  })
  const allStudents = (studentsData?.data?.results || studentsData?.data || [])
    .slice()
    .sort((a, b) => (parseInt(a.roll_number) || 0) - (parseInt(b.roll_number) || 0))

  useEffect(() => {
    if (upload?.ai_output_json?.matched) {
      setSelectedAbsent(new Set(upload.ai_output_json.matched.map(m => m.student_id)))
    }
  }, [upload])

  const confirmMutation = useMutation({
    mutationFn: () => attendanceApi.confirmAttendance(uploadId, {
      absentStudentIds: Array.from(selectedAbsent),
      nameCorrections: Object.entries(nameCorrections).map(([sid, confirmed]) => ({ student_id: parseInt(sid), confirmed })),
      rollCorrections: Object.entries(rollCorrections).map(([sid, confirmed]) => ({ student_id: parseInt(sid), confirmed })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingReviews'] })
      queryClient.invalidateQueries({ queryKey: ['uploadDetail', uploadId] })
      navigate('/dashboard')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => attendanceApi.deleteUpload(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }); setShowDeleteConfirm(null); onBack() },
  })

  const handleReprocess = async () => {
    setReprocessing(true); setReprocessError(''); setReprocessSuccess('')
    try {
      const response = await attendanceApi.reprocessUpload(uploadId)
      setReprocessSuccess(`AI reprocessing complete! Found ${response.data.matched_count || 0} absent students.`)
      queryClient.invalidateQueries({ queryKey: ['uploadDetail', uploadId] })
    } catch (err) {
      setReprocessError(err.response?.data?.error || 'Failed to reprocess with AI')
    } finally { setReprocessing(false) }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
  }
  if (!upload) {
    return <div className="card text-center py-8"><p className="text-gray-500">Upload not found</p><button onClick={onBack} className="mt-2 text-primary-600">Back to list</button></div>
  }

  const isConfirmed = upload.status === 'CONFIRMED'
  const matchedStudents = upload.ai_output_json?.matched || []
  const presentStudents = upload.ai_output_json?.present || []
  const unmatchedEntries = upload.ai_output_json?.unmatched || []
  const uncertainStudents = upload.ai_output_json?.uncertain || []
  const pipelineStages = upload.ai_output_json?.pipeline_stages || {}

  const aiDetectionMap = {}
  matchedStudents.forEach(m => { aiDetectionMap[m.student_id] = { ...m, ai_status: 'ABSENT' } })
  presentStudents.forEach(m => { aiDetectionMap[m.student_id] = { ...m, ai_status: m.status === 'LATE' ? 'LATE' : 'PRESENT' } })
  uncertainStudents.forEach(m => { if (m.student_id) aiDetectionMap[m.student_id] = { ...m, ai_status: 'UNCERTAIN' } })

  const uploadImages = upload.images || []
  const isMultiPage = uploadImages.length > 1
  const totalPages = uploadImages.length || 1
  const getCurrentImageUrl = () => {
    if (uploadImages.length > 0) { const img = uploadImages.find(i => i.page_number === currentPage) || uploadImages[0]; return img?.image_url }
    return upload.image_url
  }
  const currentImageUrl = getCurrentImageUrl()

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <button onClick={onBack} className="text-primary-600 hover:text-primary-700 text-sm mb-2 inline-flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to list
          </button>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">Review: {upload.class_name} - {upload.date}</h2>
          <p className="text-sm text-gray-600">Confidence: {Math.round((upload.confidence_score || 0) * 100)}%</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${upload.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : upload.status === 'REVIEW_REQUIRED' ? 'bg-yellow-100 text-yellow-800' : upload.status === 'PROCESSING' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{upload.status_display}</span>
          {!isConfirmed && (
            <>
              <button onClick={handleReprocess} disabled={reprocessing} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {reprocessing ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Processing...</> : 'Reprocess AI'}
              </button>
              <button onClick={() => setShowDeleteConfirm(upload.id)} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
            </>
          )}
        </div>
      </div>

      {reprocessError && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{reprocessError}</div>}
      {reprocessSuccess && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{reprocessSuccess}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image Viewer */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Original Register</h3>
              {isMultiPage && <p className="text-sm text-gray-500">{totalPages} pages</p>}
            </div>
            <button onClick={() => setShowPreviewModal(true)} className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
              View Full
            </button>
          </div>
          {isMultiPage && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {uploadImages.map(img => (
                <button key={img.id} onClick={() => setCurrentPage(img.page_number)} className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === img.page_number ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Page {img.page_number}{img.processing_status === 'FAILED' && <span className="ml-1 text-red-300">!</span>}
                </button>
              ))}
            </div>
          )}
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100">
            <TransformWrapper key={currentImageUrl}><TransformComponent><img src={currentImageUrl} alt="Register" className="w-full h-auto" /></TransformComponent></TransformWrapper>
          </div>
          <p className="text-xs text-gray-500 mt-2">Scroll to zoom, drag to pan{isMultiPage && ` | Page ${currentPage} of ${totalPages}`}</p>
        </div>

        {/* Review Table */}
        <div className="card">
          {upload.ai_output_json?.notes && (
            <div className="mb-4"><h3 className="text-sm font-medium text-gray-700 mb-2">AI Notes</h3><p className="text-sm text-gray-600 bg-blue-50 border border-blue-200 p-3 rounded-lg">{upload.ai_output_json.notes}</p></div>
          )}
          <div className="mb-4 p-3 bg-gray-100 rounded-lg">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-gray-700">Total: <strong>{allStudents.length}</strong></span>
              <span className="text-blue-600">AI matched: <strong>{Object.keys(aiDetectionMap).length}</strong></span>
              <span><span className="text-green-600 font-medium">{allStudents.length - selectedAbsent.size}P</span>{' / '}<span className="text-red-600 font-medium">{selectedAbsent.size}A</span></span>
            </div>
          </div>

          {allStudents.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="sm:hidden space-y-2 max-h-[32rem] overflow-y-auto mb-4">
                {allStudents.map(student => {
                  const aiInfo = aiDetectionMap[student.id]
                  const isAbsent = selectedAbsent.has(student.id)
                  return (
                    <div key={student.id} className={`p-3 rounded-lg border ${isAbsent ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-xs text-gray-400 font-mono flex-shrink-0">{student.roll_number}</span>
                          <span className="font-medium text-sm text-gray-900 truncate">{student.name}</span>
                          {isMultiPage && aiInfo?.page && <button type="button" onClick={() => setCurrentPage(aiInfo.page)} className="text-xs px-1 py-0.5 rounded bg-purple-100 text-purple-600 flex-shrink-0">P{aiInfo.page}</button>}
                        </div>
                        {!isConfirmed ? (
                          <div className="inline-flex rounded-md overflow-hidden border border-gray-300 flex-shrink-0 ml-2">
                            <button onClick={() => { const s = new Set(selectedAbsent); s.delete(student.id); setSelectedAbsent(s) }} className={`px-3 py-1.5 text-sm font-semibold transition-colors ${!isAbsent ? 'bg-green-500 text-white' : 'bg-white text-gray-400'}`}>P</button>
                            <button onClick={() => { const s = new Set(selectedAbsent); s.add(student.id); setSelectedAbsent(s) }} className={`px-3 py-1.5 text-sm font-semibold transition-colors ${isAbsent ? 'bg-red-500 text-white' : 'bg-white text-gray-400'}`}>A</button>
                          </div>
                        ) : (
                          <span className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ml-2 ${isAbsent ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{isAbsent ? 'Absent' : 'Present'}</span>
                        )}
                      </div>
                      {aiInfo && (
                        <div className="flex flex-wrap gap-2 mt-1 text-xs">
                          {aiInfo.extracted_name && <span className="text-gray-500">AI: &quot;{aiInfo.extracted_name}&quot;{aiInfo.match_score > 0 && <span className={`ml-1 font-medium ${aiInfo.match_score >= 0.7 ? 'text-green-600' : 'text-yellow-600'}`}>{Math.round(aiInfo.match_score * 100)}%</span>}</span>}
                          {aiInfo.raw_mark && <span className={`px-1 py-0.5 rounded ${aiInfo.ai_status === 'ABSENT' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>mark: {aiInfo.raw_mark}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Desktop Table - Simplified */}
              <div className="hidden sm:block overflow-x-auto max-h-[32rem] overflow-y-auto mb-4 border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr className="text-xs text-gray-500 uppercase tracking-wider">
                      <th className="px-2 py-2 text-left w-10">#</th>
                      <th className="px-2 py-2 text-left">Student</th>
                      <th className="px-2 py-2 text-left border-l border-gray-200">Name Match</th>
                      <th className="px-2 py-2 text-left border-l border-gray-200">Roll Match</th>
                      <th className="px-2 py-2 text-center border-l border-gray-200 w-28">Attendance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allStudents.map(student => {
                      const aiInfo = aiDetectionMap[student.id]
                      const isAbsent = selectedAbsent.has(student.id)
                      const nameState = nameCorrections[student.id]
                      const rollState = rollCorrections[student.id]
                      return (
                        <tr key={student.id} className={`${isAbsent ? 'bg-red-50' : 'hover:bg-gray-50'} transition-colors`}>
                          <td className="px-2 py-2 font-mono text-xs text-gray-400">{student.roll_number}</td>
                          <td className="px-2 py-2">
                            <span className="font-medium text-gray-900 text-sm">{student.name}</span>
                            {isMultiPage && aiInfo?.page && <button type="button" onClick={() => setCurrentPage(aiInfo.page)} className="ml-1 text-xs px-1 py-0.5 rounded bg-purple-100 text-purple-600 hover:bg-purple-200">P{aiInfo.page}</button>}
                          </td>
                          <td className="px-2 py-2 border-l border-gray-200">
                            {aiInfo?.extracted_name ? (
                              <div className="flex items-center gap-1">
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs text-gray-600 block truncate" title={aiInfo.extracted_name}>{aiInfo.extracted_name}</span>
                                  <div className="flex items-center gap-1">
                                    {aiInfo.match_score > 0 && <span className={`text-xs font-medium ${aiInfo.match_score >= 0.7 ? 'text-green-600' : aiInfo.match_score >= 0.5 ? 'text-yellow-600' : 'text-red-600'}`}>{Math.round(aiInfo.match_score * 100)}%</span>}
                                    {aiInfo.match_method && <span className="text-xs text-gray-400">{aiInfo.match_method === 'name_fuzzy' ? 'name' : aiInfo.match_method === 'roll_exact' ? 'roll' : aiInfo.match_method === 'serial_order' ? 'order' : ''}</span>}
                                  </div>
                                </div>
                                {!isConfirmed && (
                                  <div className="flex gap-0.5 flex-shrink-0">
                                    <button onClick={() => setNameCorrections(prev => { const n = {...prev}; if (n[student.id] === true) delete n[student.id]; else n[student.id] = true; return n })} className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${nameState === true ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'}`} title="Confirm">&#10003;</button>
                                    <button onClick={() => setNameCorrections(prev => { const n = {...prev}; if (n[student.id] === false) delete n[student.id]; else n[student.id] = false; return n })} className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${nameState === false ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600'}`} title="Reject">&#10007;</button>
                                  </div>
                                )}
                              </div>
                            ) : <span className="text-xs text-gray-300 italic">Not detected</span>}
                          </td>
                          <td className="px-2 py-2 border-l border-gray-200">
                            {aiInfo?.extracted_serial ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-mono text-gray-600">{aiInfo.extracted_serial}&rarr;{student.roll_number}</span>
                                {!isConfirmed && (
                                  <div className="flex gap-0.5 flex-shrink-0">
                                    <button onClick={() => setRollCorrections(prev => { const n = {...prev}; if (n[student.id] === true) delete n[student.id]; else n[student.id] = true; return n })} className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${rollState === true ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'}`}>&#10003;</button>
                                    <button onClick={() => setRollCorrections(prev => { const n = {...prev}; if (n[student.id] === false) delete n[student.id]; else n[student.id] = false; return n })} className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${rollState === false ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600'}`}>&#10007;</button>
                                  </div>
                                )}
                              </div>
                            ) : <span className="text-xs text-gray-300">--</span>}
                          </td>
                          <td className="px-2 py-2 border-l border-gray-200">
                            <div className="flex items-center justify-center gap-1">
                              {aiInfo && <span className={`text-xs px-1 py-0.5 rounded ${aiInfo.ai_status === 'ABSENT' ? 'bg-red-100 text-red-600' : aiInfo.ai_status === 'PRESENT' ? 'bg-green-100 text-green-600' : aiInfo.ai_status === 'LATE' ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'}`} title={`AI: ${aiInfo.ai_status}`}>{aiInfo.raw_mark || aiInfo.ai_status?.[0] || '?'}</span>}
                              {!isConfirmed ? (
                                <div className="inline-flex rounded-md overflow-hidden border border-gray-300">
                                  <button onClick={() => { const s = new Set(selectedAbsent); s.delete(student.id); setSelectedAbsent(s) }} className={`px-2.5 py-1 text-xs font-semibold transition-colors ${!isAbsent ? 'bg-green-500 text-white' : 'bg-white text-gray-400 hover:bg-green-50 hover:text-green-600'}`}>P</button>
                                  <button onClick={() => { const s = new Set(selectedAbsent); s.add(student.id); setSelectedAbsent(s) }} className={`px-2.5 py-1 text-xs font-semibold transition-colors ${isAbsent ? 'bg-red-500 text-white' : 'bg-white text-gray-400 hover:bg-red-50 hover:text-red-600'}`}>A</button>
                                </div>
                              ) : <span className={`px-2 py-1 rounded text-xs font-medium ${isAbsent ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{isAbsent ? 'A' : 'P'}</span>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500 mb-4"><p>No students found in this class.</p></div>
          )}

          {unmatchedEntries.length > 0 && (
            <details className="mb-4">
              <summary className="text-sm font-medium text-yellow-700 cursor-pointer hover:text-yellow-800">Unmatched OCR entries ({unmatchedEntries.length})</summary>
              <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                {unmatchedEntries.map((entry, idx) => (
                  <div key={idx} className="text-xs text-yellow-800 flex items-center justify-between">
                    <span>Serial: {entry.roll_number || '?'} | "{entry.extracted_name || '?'}"</span>
                    <span className="text-yellow-600">{entry.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {Object.keys(pipelineStages).length > 0 && (
            <details className="mb-4">
              <summary className="text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700">Pipeline Details</summary>
              <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-2">
                {pipelineStages.google_vision && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Google Cloud Vision</span>
                      <span className={`px-2 py-0.5 rounded ${pipelineStages.google_vision.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {pipelineStages.google_vision.status}{pipelineStages.google_vision.students_found !== undefined && ` (${pipelineStages.google_vision.students_found} students)`}
                      </span>
                    </div>
                  </div>
                )}
                {pipelineStages.groq_vision && (
                  <div className="flex items-center justify-between">
                    <span>Groq Vision AI</span>
                    <span className={`px-2 py-0.5 rounded ${pipelineStages.groq_vision.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{pipelineStages.groq_vision.status}</span>
                  </div>
                )}
              </div>
            </details>
          )}

          {!isConfirmed && (
            <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending} className="w-full btn btn-primary py-3 text-lg disabled:opacity-50">
              {confirmMutation.isPending ? (
                <span className="flex items-center justify-center"><svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Confirming...</span>
              ) : `Confirm Attendance (${selectedAbsent.size} Absent)`}
            </button>
          )}
          {confirmMutation.isError && <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{confirmMutation.error?.response?.data?.error || 'Failed to confirm attendance'}</div>}
          {isConfirmed && (
            <div className="text-center py-4 bg-green-50 rounded-lg">
              <svg className="mx-auto h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <p className="mt-2 text-green-700 font-medium">Attendance Confirmed</p>
              <p className="text-sm text-green-600">Confirmed by {upload.confirmed_by_name} at {new Date(upload.confirmed_at).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Upload?</h3>
            <p className="text-gray-600 mb-4">This will permanently delete this attendance upload.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={() => deleteMutation.mutate(showDeleteConfirm)} disabled={deleteMutation.isPending} className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">{deleteMutation.isPending ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
          <div className="relative w-full h-full p-4">
            <button onClick={() => setShowPreviewModal(false)} className="absolute top-4 right-4 z-10 p-3 bg-white rounded-full shadow-lg hover:bg-gray-100">
              <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-2 sm:p-3 max-w-[calc(100%-6rem)]">
              <p className="text-sm font-medium text-gray-900">{upload.class_name}</p>
              <p className="text-xs text-gray-500">{upload.date}</p>
              {isMultiPage && <p className="text-xs text-gray-500 mt-1">Page {currentPage} of {totalPages}</p>}
            </div>
            {isMultiPage && (
              <div className="absolute top-16 sm:top-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-1 sm:gap-2 bg-white rounded-lg shadow-lg p-1 sm:p-2">
                {uploadImages.map(img => (
                  <button key={img.id} onClick={() => setCurrentPage(img.page_number)} className={`px-3 py-1 rounded text-sm font-medium transition-colors ${currentPage === img.page_number ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Page {img.page_number}</button>
                ))}
              </div>
            )}
            <div className="w-full h-full flex items-center justify-center">
              <TransformWrapper key={currentImageUrl} initialScale={1} minScale={0.5} maxScale={5} centerOnInit={true}>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-2 bg-white rounded-lg shadow-lg p-2">
                      {isMultiPage && <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>}
                      <button onClick={() => zoomOut()} className="p-2 hover:bg-gray-100 rounded"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" /></svg></button>
                      <button onClick={() => resetTransform()} className="p-2 hover:bg-gray-100 rounded"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
                      <button onClick={() => zoomIn()} className="p-2 hover:bg-gray-100 rounded"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg></button>
                      {isMultiPage && <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></button>}
                    </div>
                    <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}><img src={currentImageUrl} alt="Full view" className="max-w-full max-h-full object-contain" /></TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// PENDING REVIEW TAB (list + inline detail)
// ═══════════════════════════════════════════
function PendingReviewTab({ initialReviewId }) {
  const [reviewId, setReviewId] = useState(initialReviewId || null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const queryClient = useQueryClient()

  const { data: pendingList, isLoading } = useQuery({
    queryKey: ['pendingReviews'],
    queryFn: () => attendanceApi.getPendingReviews(),
  })

  const deleteMutation = useMutation({
    mutationFn: (uploadId) => attendanceApi.deleteUpload(uploadId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }); setShowDeleteConfirm(null) },
  })

  // If reviewing a specific upload, show detail
  if (reviewId) {
    return <ReviewDetail uploadId={reviewId} onBack={() => setReviewId(null)} />
  }

  return (
    <div>
      {isLoading ? (
        <div className="card text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div><p className="mt-2 text-gray-500">Loading...</p></div>
      ) : pendingList?.data?.length === 0 ? (
        <div className="card text-center py-8">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="mt-2 text-gray-500">No pending reviews</p>
          <p className="mt-1 text-sm text-gray-400">Upload attendance registers to get started</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {pendingList?.data?.map(item => (
            <div key={item.id} className="card hover:shadow-md transition-shadow cursor-pointer" onClick={() => setReviewId(item.id)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{item.class_name}</p>
                  <p className="text-sm text-gray-500">{item.date}</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${item.status === 'REVIEW_REQUIRED' ? 'bg-yellow-100 text-yellow-800' : item.status === 'PROCESSING' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{item.status_display}</span>
                  <button onClick={e => { e.stopPropagation(); setShowDeleteConfirm(item.id) }} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Upload?</h3>
            <p className="text-gray-600 mb-4">This will permanently delete this attendance upload.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={() => deleteMutation.mutate(showDeleteConfirm)} disabled={deleteMutation.isPending} className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">{deleteMutation.isPending ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════
export default function CaptureReviewPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const reviewIdFromQuery = searchParams.get('review')

  // Default tab: if there's a review ID, go to review tab, else upload
  const initialTab = (id || reviewIdFromQuery) ? 'review' : (searchParams.get('tab') || 'upload')
  const [activeTab, setActiveTab] = useState(initialTab)

  // Fetch pending count for badge
  const { data: pendingList } = useQuery({
    queryKey: ['pendingReviews'],
    queryFn: () => attendanceApi.getPendingReviews(),
  })
  const pendingCount = pendingList?.data?.length || 0

  const switchTab = (tab) => {
    setActiveTab(tab)
    setSearchParams(tab === 'upload' ? {} : { tab })
  }

  const handleUploadSuccess = (uploadId) => {
    setActiveTab('review')
    setSearchParams({ tab: 'review', review: uploadId })
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Capture & Review</h1>
        <p className="text-sm text-gray-600">Upload attendance registers and review AI results</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4 overflow-x-auto">
        <nav className="flex space-x-1 sm:space-x-2 min-w-max">
          <TabButton active={activeTab === 'upload'} onClick={() => switchTab('upload')}>Upload</TabButton>
          <TabButton active={activeTab === 'review'} onClick={() => switchTab('review')} badge={pendingCount}>Pending Review</TabButton>
        </nav>
      </div>

      {activeTab === 'upload' && <UploadTab onUploadSuccess={handleUploadSuccess} />}
      {activeTab === 'review' && <PendingReviewTab initialReviewId={id || reviewIdFromQuery} />}
    </div>
  )
}
