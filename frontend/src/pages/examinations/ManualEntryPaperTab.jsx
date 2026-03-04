import { useState } from 'react'
import RichTextEditor from '../../components/RichTextEditor'

/**
 * ManualEntryPaperTab - Manually create exam papers by typing
 */
export default function ManualEntryPaperTab({ onPaperCreate, isLoading }) {
  const [paperTitle, setPaperTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [questions, setQuestions] = useState([])
  const [totalMarks, setTotalMarks] = useState('100')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [currentQuestion, setCurrentQuestion] = useState({
    question_text: '',
    question_type: 'SHORT',
    marks: 1,
    options: { A: '', B: '', C: '', D: '' },
  })
  const [errors, setErrors] = useState({})
  const [showReview, setShowReview] = useState(false)

  const questionTypes = [
    { value: 'MCQ', label: 'Multiple Choice' },
    { value: 'SHORT', label: 'Short Answer' },
    { value: 'ESSAY', label: 'Essay' },
    { value: 'TRUE_FALSE', label: 'True/False' },
    { value: 'MATCHING', label: 'Matching' },
    { value: 'FILL_BLANK', label: 'Fill in the Blanks' },
  ]

  // Add question to list
  const handleAddQuestion = () => {
    const newErrors = {}

    if (!currentQuestion.question_text.trim()) {
      newErrors.question_text = 'Question text is required'
    }

    if (currentQuestion.question_type === 'MCQ') {
      if (!currentQuestion.options.A || !currentQuestion.options.B) {
        newErrors.options = 'MCQ requires at least options A and B'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setQuestions([...questions, { ...currentQuestion, id: Math.random() }])
    resetQuestion()
    setErrors({})
  }

  const resetQuestion = () => {
    setCurrentQuestion({
      question_text: '',
      question_type: 'SHORT',
      marks: 1,
      options: { A: '', B: '', C: '', D: '' },
    })
  }

  // Remove question from list
  const handleRemoveQuestion = (id) => {
    setQuestions(questions.filter((q) => q.id !== id))
  }

  // Update question in list
  const handleEditQuestion = (id) => {
    const q = questions.find((q) => q.id === id)
    setCurrentQuestion(q)
    handleRemoveQuestion(id)
  }

  // Calculate total from questions
  const calculateTotal = () => {
    return questions.reduce((sum, q) => sum + (q.marks || 0), 0)
  }

  // Handle form submission
  const handleCreatePaper = async (e) => {
    e.preventDefault()

    const newErrors = {}

    if (!paperTitle.trim()) newErrors.paperTitle = 'Paper title is required'
    if (questions.length === 0) newErrors.questions = 'Add at least one question'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const paperData = {
      paper_title: paperTitle,
      instructions,
      total_marks: parseFloat(totalMarks),
      duration_minutes: parseInt(durationMinutes),
      questions_data: questions.map((q, idx) => ({
        question_id: q.id,
        question_order: idx + 1,
        marks_override: q.marks,
      })),
    }

    onPaperCreate(paperData, questions)
  }

  const currentTotal = calculateTotal()

  return (
    <div className="space-y-6">
      {/* Paper Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Paper Title *
          </label>
          <input
            type="text"
            value={paperTitle}
            onChange={(e) => setPaperTitle(e.target.value)}
            placeholder="e.g., Physics Mid-Term 2026"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.paperTitle && <p className="text-red-500 text-sm mt-1">{errors.paperTitle}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Total Marks
          </label>
          <input
            type="number"
            value={totalMarks}
            onChange={(e) => setTotalMarks(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Duration (minutes)
          </label>
          <input
            type="number"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Questions Count
          </label>
          <div className="text-2xl font-bold text-blue-600">{questions.length}</div>
        </div>
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Instructions
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Enter general instructions for students..."
          rows="4"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Question Form */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          Add Question {questions.length + 1}
        </h3>

        {/* Question Type and Marks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Question Type
            </label>
            <select
              value={currentQuestion.question_type}
              onChange={(e) =>
                setCurrentQuestion({ ...currentQuestion, question_type: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {questionTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Marks
            </label>
            <input
              type="number"
              value={currentQuestion.marks}
              onChange={(e) =>
                setCurrentQuestion({ ...currentQuestion, marks: parseFloat(e.target.value) })
              }
              min="0.5"
              step="0.5"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-end">
            <div className="text-sm text-gray-600">
              Running Total: <span className="font-bold text-lg">{currentTotal}</span>
            </div>
          </div>
        </div>

        {/* Question Text */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Question Text *
          </label>
          <RichTextEditor
            value={currentQuestion.question_text}
            onChange={(html) =>
              setCurrentQuestion({ ...currentQuestion, question_text: html })
            }
            placeholder="Type your question here..."
          />
          {errors.question_text && (
            <p className="text-red-500 text-sm mt-1">{errors.question_text}</p>
          )}
        </div>

        {/* MCQ Options */}
        {currentQuestion.question_type === 'MCQ' && (
          <div className="space-y-3 mb-4 bg-white p-4 rounded border border-gray-200">
            <p className="text-sm font-semibold text-gray-700">MCQ Options</p>
            {['A', 'B', 'C', 'D'].map((option) => (
              <div key={option} className="flex gap-2">
                <label className="font-bold text-gray-700 w-6">{option}.</label>
                <input
                  type="text"
                  value={currentQuestion.options[option]}
                  onChange={(e) =>
                    setCurrentQuestion({
                      ...currentQuestion,
                      options: { ...currentQuestion.options, [option]: e.target.value },
                    })
                  }
                  placeholder={`Option ${option}`}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            ))}
            {errors.options && <p className="text-red-500 text-sm">{errors.options}</p>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={resetQuestion}
            type="button"
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            Reset
          </button>
          <button
            onClick={handleAddQuestion}
            type="button"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add Question
          </button>
        </div>
      </div>

      {/* Questions List */}
      {questions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-800">
            Questions ({questions.length})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className="flex gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">
                    Q{idx + 1}. {q.question_type} [{q.marks}M]
                  </div>
                  <div
                    className="text-sm text-gray-600 mt-1 line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: q.question_text }}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditQuestion(q.id)}
                    className="px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleRemoveQuestion(q.id)}
                    className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit */}
      {questions.length > 0 && (
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
          {errors.questions && <p className="text-red-500 text-sm">{errors.questions}</p>}
          <button
            onClick={handleCreatePaper}
            disabled={isLoading}
            className={`px-6 py-2 rounded-lg font-medium ${
              isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isLoading ? 'Creating...' : 'Create Paper'}
          </button>
        </div>
      )}
    </div>
  )
}
