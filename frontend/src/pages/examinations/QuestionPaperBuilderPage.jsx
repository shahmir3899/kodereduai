import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { questionPaperApi, examinationsApi } from '../../services/api'
import Toast from '../../components/Toast'
import ClassSelector from '../../components/ClassSelector'
import SubjectSelector from '../../components/SubjectSelector'
import ImageCapturePaperTab from './ImageCapturePaperTab'
import ManualEntryPaperTab from './ManualEntryPaperTab'

/**
 * QuestionPaperBuilderPage - Main Question Paper Builder
 * Supports two modes:
 * 1. Image capture - Upload handwritten paper → OCR → Review
 * 2. Manual entry - Type questions with rich editor
 */
export default function QuestionPaperBuilderPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('manual') // 'manual' or 'image'
  const [toast, setToast] = useState(null)
  const [paperMetadata, setPaperMetadata] = useState({
    class_obj: '',
    subject: '',
    exam: '',
  })

  // Fetch exams
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examinationsApi.getExams({ page_size: 999 }),
  })

  const exams = examsData?.data?.results || []

  // Create exam paper mutation
  const createPaperMutation = useMutation({
    mutationFn: (data) => questionPaperApi.createExamPaper(data),
    onSuccess: (response) => {
      setToast({
        type: 'success',
        message: 'Exam paper created successfully!',
      })
      // Redirect to paper detail/preview
      setTimeout(() => {
        navigate(`/examinations/papers/${response.data.id}`)
      }, 1500)
    },
    onError: (error) => {
      const msg = error.response?.data?.detail || 'Error creating exam paper'
      setToast({
        type: 'error',
        message: msg,
      })
    },
  })

  // Handle paper creation from either tab
  const handlePaperCreate = (paperData, questionsData) => {
    // Ensure metadata is included
    const finalData = {
      ...paperMetadata,
      ...paperData,
      status: 'DRAFT',
    }

    createPaperMutation.mutate(finalData)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">Question Paper Builder</h1>
          <p className="text-gray-600 mt-1">
            Create exam papers by uploading handwritten questions or typing manually
          </p>
        </div>
      </div>

      {/* Toast notifications */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Metadata form */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Paper Metadata</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Class *
              </label>
              <ClassSelector
                value={paperMetadata.class_obj}
                onChange={(e) =>
                  setPaperMetadata({ ...paperMetadata, class_obj: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject *
              </label>
              <SubjectSelector
                value={paperMetadata.subject}
                onChange={(e) =>
                  setPaperMetadata({ ...paperMetadata, subject: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Exam (Optional)
              </label>
              <select
                value={paperMetadata.exam}
                onChange={(e) =>
                  setPaperMetadata({ ...paperMetadata, exam: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={examsLoading}
              >
                <option value="">{examsLoading ? 'Loading exams...' : 'Select Exam (Optional)'}</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.exam_type?.name} - {exam.exam_subject?.subject?.name} ({new Date(exam.exam_date).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Tab buttons */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('manual')}
              className={`flex-1 px-6 py-4 font-medium text-center transition ${
                activeTab === 'manual'
                  ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <span className="text-xl mr-2">⌨️</span>
              Manual Entry
            </button>
            <button
              onClick={() => setActiveTab('image')}
              className={`flex-1 px-6 py-4 font-medium text-center transition ${
                activeTab === 'image'
                  ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <span className="text-xl mr-2">📸</span>
              Capture from Image
            </button>
          </div>

          {/* Tab content */}
          <div className="p-8">
            {activeTab === 'manual' && (
              <ManualEntryPaperTab
                onPaperCreate={handlePaperCreate}
                isLoading={createPaperMutation.isPending}
              />
            )}

            {activeTab === 'image' && (
              <ImageCapturePaperTab
                onPaperCreate={handlePaperCreate}
                isLoading={createPaperMutation.isPending}
              />
            )}
          </div>
        </div>

        {/* Help text */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2">💡 Manual Entry Tips</h4>
            <ul className="text-sm text-blue-800 space-y-1 list-disc pl-4">
              <li>Use the rich editor for formatting</li>
              <li>Add questions one by one for better control</li>
              <li>MCQ requires at least options A and B</li>
              <li>Review all questions before creating the paper</li>
            </ul>
          </div>

          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <h4 className="font-semibold text-green-900 mb-2">🎯 Image Capture Tips</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc pl-4">
              <li>Take a clear photo of the handwritten paper</li>
              <li>Ensure good lighting and no shadows</li>
              <li>AI will extract and parse questions automatically</li>
              <li>Review and correct any extraction errors before confirming</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
