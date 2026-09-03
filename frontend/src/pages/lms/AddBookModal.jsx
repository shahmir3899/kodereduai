import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import ClassSelector from '../../components/ClassSelector'
import SubjectSelector from '../../components/SubjectSelector'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import { isRTLLanguage } from '../../components/RTLWrapper'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu' },
  { value: 'ar', label: 'Arabic' },
  { value: 'sd', label: 'Sindhi' },
  { value: 'ps', label: 'Pashto' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'other', label: 'Other' },
]

const EMPTY_BOOK_FORM = {
  title: '',
  author: '',
  publisher: '',
  edition: '',
  language: 'en',
  description: '',
}

export default function AddBookModal({
  isOpen,
  onClose,
  onSuccess,
  schoolId,
  activeAcademicYearId,
}) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [bookForm, setBookForm] = useState({ ...EMPTY_BOOK_FORM })

  const classSelectorScope = getClassSelectorScope(activeAcademicYearId)
  const { sessionClasses } = useSessionClasses(activeAcademicYearId)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYearId, sessionClasses)
  const { subjects: classSubjects, isLoading: classSubjectsLoading } = useClassSubjects(resolvedSelectedClass)
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYearId,
    selectedClass,
    setSelectedClass,
    autoSelectFirst: false,
    queryKey: 'teacherCurriculumAddBookClasses',
  })

  const { data: existingBooksData, isLoading: existingBooksLoading } = useQuery({
    queryKey: ['lmsBooksCountForAddBook', resolvedSelectedClass, selectedSubject],
    queryFn: () => lmsApi.getBooks({ class_id: resolvedSelectedClass, subject_id: selectedSubject, page_size: 1 }),
    enabled: !!resolvedSelectedClass && !!selectedSubject && isOpen,
  })

  const existingBooksCount = existingBooksData?.data?.count ?? existingBooksData?.data?.results?.length ?? existingBooksData?.data?.length ?? 0

  useEffect(() => {
    if (!isOpen) return
    setSelectedClass('')
    setSelectedSubject('')
    setBookForm({ ...EMPTY_BOOK_FORM })
  }, [isOpen])

  const createBookMutation = useMutation({
    mutationFn: (data) => lmsApi.createBook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBooks'] })
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      showSuccess('Book created')
      onSuccess?.()
      onClose()
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.title?.[0] || 'Failed to create book')
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!bookForm.title) {
      showError('Title is required')
      return
    }
    if (!resolvedSelectedClass) {
      showError('Class is required')
      return
    }
    if (!selectedSubject) {
      showError('Subject is required')
      return
    }

    createBookMutation.mutate({
      ...bookForm,
      school: schoolId,
      class_obj: parseInt(resolvedSelectedClass, 10),
      subject: parseInt(selectedSubject, 10),
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Add Book</h2>
        <p className="text-sm text-gray-600 mb-4">Choose the target class and subject here, then enter the book details.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Class *</label>
              <ClassSelector
                value={selectedClass}
                onChange={(e) => {
                  setSelectedClass(e.target.value)
                  setSelectedSubject('')
                }}
                placeholder="Select Class"
                scope={classSelectorScope}
                academicYearId={activeAcademicYearId}
                showAllOption={showAllOption}
                classes={teacherClassOptions || undefined}
              />
            </div>
            <div>
              <label className="label">Subject *</label>
              <SubjectSelector
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                placeholder={!selectedClass ? 'Select a class first' : 'Select Subject'}
                disabled={!selectedClass || classSubjectsLoading}
                subjects={resolvedSelectedClass ? classSubjects : []}
              />
              {selectedSubject && (
                <div className="mt-2">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200">
                    {existingBooksLoading
                      ? 'Checking existing books...'
                      : `${existingBooksCount} existing book${existingBooksCount === 1 ? '' : 's'}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="label">Title *</label>
            <input
              type="text"
              className="input"
              placeholder="e.g., Mathematics Grade 5"
              dir={isRTLLanguage(bookForm.language) ? 'rtl' : 'ltr'}
              value={bookForm.title}
              onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Author</label>
              <input
                type="text"
                className="input"
                value={bookForm.author}
                onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Publisher</label>
              <input
                type="text"
                className="input"
                value={bookForm.publisher}
                onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Edition</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., 3rd Edition"
                value={bookForm.edition}
                onChange={(e) => setBookForm({ ...bookForm, edition: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Language</label>
              <select
                className="input"
                value={bookForm.language}
                onChange={(e) => setBookForm({ ...bookForm, language: e.target.value })}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={3}
              dir={isRTLLanguage(bookForm.language) ? 'rtl' : 'ltr'}
              placeholder="Brief description of the book..."
              value={bookForm.description}
              onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={createBookMutation.isPending} className="btn btn-primary">
              {createBookMutation.isPending ? 'Saving...' : 'Add Book'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}