import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
import RichTextEditor from '../../components/RichTextEditor'
import Toast from '../../components/Toast'

/**
 * ImageCapturePaperTab - Upload handwritten question papers for OCR extraction
 */
export default function ImageCapturePaperTab({ onPaperCreate, isLoading }) {
  const [uploadedImage, setUploadedImage] = useState(null)
  const [extractedUpload, setExtractedUpload] = useState(null)
  const [confirmingQuestions, setConfirmingQuestions] = useState([])
  const [paperMetadata, setPaperMetadata] = useState({
    class_obj: '',
    subject: '',
    exam: '',
    paper_title: '',
    instructions: '',
    total_marks: '100',
    duration_minutes: '60',
  })
  const [toast, setToast] = useState(null)

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file) =>
      questionPaperApi.uploadPaperImage(
        file,
        paperMetadata.class_obj || null,
        paperMetadata.subject || null
      ),
    onSuccess: (data) => {
      setExtractedUpload(data.data)
      setConfirmingQuestions(
        data.data.ai_extracted_json?.questions?.map((q, idx) => ({
          ...q,
          id: idx,
          question_text: q.question_text || '',
          question_type: q.question_type || 'SHORT',
          marks: q.marks || 1,
          options: q.options || { A: '', B: '', C: '', D: '' },
        })) || []
      )
      setToast({
        type: 'success',
        message: `OCR Extraction Complete: ${data.data.ai_extracted_json?.questions?.length || 0} questions found`,
      })
    },
    onError: (error) => {
      const msg = error.response?.data?.detail || 'Error uploading image'
      setToast({ type: 'error', message: msg })
    },
  })

  // Polling for OCR status
  const { refetch: checkUploadStatus } = useQuery({
    queryKey: ['paperUpload', extractedUpload?.id],
    queryFn: () => questionPaperApi.getPaperUpload(extractedUpload?.id),
    enabled: false,
    onSuccess: (data) => {
      if (data.data.status === 'EXTRACTED') {
        setExtractedUpload(data.data)
        setConfirmingQuestions(
          data.data.ai_extracted_json?.questions?.map((q, idx) => ({
            ...q,
            id: idx,
          })) || []
        )
      } else if (data.data.status === 'FAILED') {
        setToast({ type: 'error', message: 'OCR extraction failed. Please try again.' })
      }
    },
  })

  // Handle file drop
  const onDrop = useCallback((acceptedFiles) => {
    const file = acceptedFiles[0]
    if (file) {
      // Compress image using Compressor.js
      import('compressorjs').then(({ default: Compressor }) => {
        new Compressor(file, {
          quality: 0.8,
          maxWidth: 2000,
          maxHeight: 2000,
          mimeType: 'image/jpeg',
          success: (result) => {
            setUploadedImage({
              file: new File([result], file.name, { type: 'image/jpeg' }),
              preview: URL.createObjectURL(file),
            })
            // Auto-upload
            uploadMutation.mutate(new File([result], file.name, { type: 'image/jpeg' }))
          },
          error: () => {
            setToast({ type: 'error', message: 'Error compressing image' })
          },
        })
      })
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    maxSize: 10 * 1024 * 1024,
  })

  // Enhance input props to support camera capture on mobile
  const inputProps = {
    ...getInputProps(),
    capture: 'environment', // Opens rear camera on mobile devices
  }

  // Update question in confirmation list
  const handleUpdateQuestion = (id, updates) => {
    setConfirmingQuestions(
      confirmingQuestions.map((q) => (q.id === id ? { ...q, ...updates } : q))
    )
  }

  // Handle confirmation
  const handleConfimpaper = async () => {
    const confirmMutation = useMutation({
      mutationFn: () =>
        questionPaperApi.confirmPaperUpload(extractedUpload.id, {
          confirmed_data: { questions: confirmingQuestions },
          paper_metadata: paperMetadata,
        }),
      onSuccess: (data) => {
        setToast({
          type: 'success',
          message: `Paper confirmed! Created ${data.data.questions_created} questions.`,
        })
        onPaperCreate(data.data)
      },
      onError: (error) => {
        const msg = error.response?.data?.detail || 'Error confirming paper'
        setToast({ type: 'error', message: msg })
      },
    })

    confirmMutation.mutate()
  }

  if (uploadMutation.isPending) {
    return (
      <div className="flexflex-col items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Processing image with OCR...</p>
      </div>
    )
  }

  if (!uploadedImage) {
    // Upload state
    return (
      <div className="space-y-6">
        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input {...inputProps} />
          <div className="text-4xl mb-3">📸</div>
          <p className="text-lg font-medium text-gray-800">
            {isDragActive ? 'Drop your paper image here' : 'Upload Question Paper Image'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Drag & drop a clear photo of your handwritten exam paper, or click to browse
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Supports JPEG, PNG, WebP • Max 10 MB • Camera enabled on mobile
          </p>
        </div>

        {/* Paper Metadata (optional) */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-semibold text-gray-800 mb-3">Paper Details (Optional)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Paper Title"
              value={paperMetadata.paper_title}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, paper_title: e.target.value })
              }
              className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              placeholder="Total Marks"
              value={paperMetadata.total_marks}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, total_marks: e.target.value })
              }
              className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
    )
  }

  if (extractedUpload && confirmingQuestions.length > 0) {
    // Review & confirm state
    return (
      <div className="space-y-6">
        {/* Image Preview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <h4 className="font-semibold text-gray-800 mb-2">Uploaded Image</h4>
            <img
              src={uploadedImage.preview}
              alt="Question paper"
              className="w-full h-auto border border-gray-300 rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-2">
              Confidence: {(extractedUpload.extraction_confidence * 100).toFixed(1)}%
            </p>
          </div>

          {/* Questions for review */}
          <div className="md:col-span-2 space-y-4">
            <h4 className="font-semibold text-gray-800">
              Review Extracted Questions ({confirmingQuestions.length})
            </h4>

            <div className="space-y-3 max-h-96 overflow-y-auto bg-gray-50 p-4 rounded">
              {confirmingQuestions.map((question, idx) => (
                <div key={question.id} className="bg-white p-4 border border-gray-200 rounded-lg space-y-3">
                  {/* Question number, type, marks */}
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className="font-bold text-gray-800">Q{idx + 1}.</span>
                    <select
                      value={question.question_type}
                      onChange={(e) =>
                        handleUpdateQuestion(question.id, { question_type: e.target.value })
                      }
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="MCQ">MCQ</option>
                      <option value="SHORT">Short</option>
                      <option value="ESSAY">Essay</option>
                      <option value="TRUE_FALSE">T/F</option>
                      <option value="FILL_BLANK">Fill</option>
                    </select>
                    <input
                      type="number"
                      value={question.marks}
                      onChange={(e) =>
                        handleUpdateQuestion(question.id, { marks: parseFloat(e.target.value) })
                      }
                      min="0.5"
                      step="0.5"
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <span className="text-sm text-gray-600">marks</span>
                  </div>

                  {/* Question text editor */}
                  <RichTextEditor
                    value={question.question_text}
                    onChange={(html) =>
                      handleUpdateQuestion(question.id, { question_text: html })
                    }
                    placeholder="Edit question text..."
                  />

                  {/* MCQ options (if applicable) */}
                  {question.question_type === 'MCQ' && (
                    <div className="space-y-2 bg-gray-50 p-2 rounded">
                      {['A', 'B', 'C', 'D'].map((opt) => (
                        <input
                          key={opt}
                          type="text"
                          value={question.options?.[opt] || ''}
                          onChange={(e) =>
                            handleUpdateQuestion(question.id, {
                              options: {
                                ...question.options,
                                [opt]: e.target.value,
                              },
                            })
                          }
                          placeholder={`Option ${opt}`}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Paper metadata form */}
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <h4 className="font-semibold text-gray-800">Paper Metadata</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Paper Title"
              value={paperMetadata.paper_title}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, paper_title: e.target.value })
              }
              className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="Instructions"
              value={paperMetadata.instructions}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, instructions: e.target.value })
              }
              rows="2"
              className="md:col-span-2 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              placeholder="Total Marks"
              value={paperMetadata.total_marks}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, total_marks: e.target.value })
              }
              className="px-3 py-2 border border-gray-300 rounded"
            />
            <input
              type="number"
              placeholder="Duration (min)"
              value={paperMetadata.duration_minutes}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, duration_minutes: e.target.value })
              }
              className="px-3 py-2 border border-gray-300 rounded"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
          <button
            onClick={() => setUploadedImage(null)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            Upload Different Image
          </button>
          <button
            onClick={handleConfimpaper}
            disabled={isLoading}
            className={`px-6 py-2 rounded-lg font-medium ${
              isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isLoading ? 'Confirming...' : 'Confirm & Create Paper'}
          </button>
        </div>
      </div>
    )
  }

  return null
}
