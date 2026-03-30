import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { schoolsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'

import SchoolProfileStep from './school-setup/SchoolProfileStep'
import AcademicYearStep from './school-setup/AcademicYearStep'
import SessionClassesStep from './school-setup/SessionClassesStep'
import ClassesStep from './school-setup/ClassesStep'
import StudentsStep from './school-setup/StudentsStep'
import StaffStep from './school-setup/StaffStep'
import SubjectsStep from './school-setup/SubjectsStep'
import FinanceStep from './school-setup/FinanceStep'
import ReviewStep from './school-setup/ReviewStep'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { useSessionClasses } from '../hooks/useSessionClasses'

const STEPS = [
  { key: 'profile',  num: 1, label: 'School Profile',   icon: '🏫', moduleKey: null },
  { key: 'academic', num: 2, label: 'Academic Year',     icon: '📅', moduleKey: 'students' },
  { key: 'session_classes', num: 3, label: 'Session Classes', icon: '🧩', moduleKey: 'students' },
  { key: 'classes',  num: 4, label: 'Classes & Grades',  icon: '📚', moduleKey: 'students' },
  { key: 'students', num: 5, label: 'Students',          icon: '👥', moduleKey: 'students' },
  { key: 'staff',    num: 6, label: 'Staff & HR',        icon: '💼', moduleKey: 'hr' },
  { key: 'subjects', num: 7, label: 'Subjects',          icon: '📖', moduleKey: 'academics' },
  { key: 'finance',  num: 8, label: 'Finance',           icon: '💰', moduleKey: 'finance' },
  { key: 'review',   num: 9, label: 'Review & Finish',   icon: '✅', moduleKey: null },
]

// Map completion module keys to wizard step keys
const MODULE_TO_STEP = {
  students: ['academic', 'classes', 'students'],
  hr: ['staff'],
  academics: ['subjects'],
  finance: ['finance'],
}

export default function SchoolSetupPage() {
  const navigate = useNavigate()
  const { activeSchool, isModuleEnabled } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { addToast } = useToast()
  const [activeStep, setActiveStep] = useState(1)
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)

  // Filter steps based on enabled modules
  const visibleSteps = useMemo(() => {
    return STEPS.filter(s => {
      if (!s.moduleKey) return true
      return isModuleEnabled(s.moduleKey)
    }).map((s, i) => ({ ...s, num: i + 1 }))
  }, [isModuleEnabled])

  // Completion data
  const { data: completionRes, refetch: refetchCompletion } = useQuery({
    queryKey: ['schoolCompletion'],
    queryFn: () => schoolsApi.getCompletion(),
  })

  const completion = completionRes?.data

  // Determine step completion status from completion API
  // Each wizard step maps to specific completion sub-steps, NOT overall module %
  const stepStatus = useMemo(() => {
    if (!completion?.modules) return {}
    const status = {}

    // Helper: find a module's steps by keyword
    const findStep = (moduleKey, ...keywords) => {
      const mod = completion.modules.find(m => m.key === moduleKey)
      if (!mod?.steps) return null
      return mod.steps.find(s =>
        keywords.some(kw => s.name?.toLowerCase().includes(kw))
      )
    }

    // Helper: is a specific sub-step completed?
    const isStepDone = (moduleKey, ...keywords) => {
      const step = findStep(moduleKey, ...keywords)
      return step ? step.completed : false
    }

    // Profile: always complete if school exists
    status.profile = 'complete'

    // Academic Year: from students module "academic year" step
    status.academic = isStepDone('students', 'academic year') ? 'complete' : 'pending'

    // Classes: from students module "class" step
    status.classes = isStepDone('students', 'class') ? 'complete' : 'pending'

    // Session classes: complete when active year exists and has at least one session class
    status.session_classes = (activeAcademicYear?.id && sessionClasses.length > 0) ? 'complete' : 'pending'

    // Students: need both students added AND enrolled
    const studentsAdded = isStepDone('students', 'student added', 'students added')
    const enrolled = isStepDone('students', 'enroll')
    status.students = (studentsAdded && enrolled) ? 'complete'
      : (studentsAdded || enrolled) ? 'partial' : 'pending'

    // Staff & HR: only check wizard-relevant steps (departments, designations, staff)
    const hrDeptDone = isStepDone('hr', 'department')
    const hrDesigDone = isStepDone('hr', 'designation')
    const hrStaffDone = isStepDone('hr', 'staff member')
    status.staff = (hrDeptDone && hrDesigDone && hrStaffDone) ? 'complete'
      : (hrDeptDone || hrDesigDone || hrStaffDone) ? 'partial' : 'pending'

    // Subjects: only check subjects created + assigned to classes
    const subjectsDone = isStepDone('academics', 'subjects created')
    const assignedDone = isStepDone('academics', 'subjects assigned')
    status.subjects = (subjectsDone && assignedDone) ? 'complete'
      : (subjectsDone || assignedDone) ? 'partial' : 'pending'

    // Finance: only check accounts + fee structures (not gateway/expense categories)
    const accountsDone = isStepDone('finance', 'account')
    const feesDone = isStepDone('finance', 'fee structure')
    status.finance = (accountsDone && feesDone) ? 'complete'
      : (accountsDone || feesDone) ? 'partial' : 'pending'

    // Review: complete when all other wizard steps are complete
    const wizardKeys = ['profile', 'academic', 'session_classes', 'classes', 'students', 'staff', 'subjects', 'finance']
    const allDone = wizardKeys.every(k => status[k] === 'complete')
    status.review = allDone ? 'complete' : 'pending'

    return status
  }, [completion, activeAcademicYear?.id, sessionClasses.length])

  // Calculate wizard-specific progress (how many of OUR steps are done)
  const wizardProgress = useMemo(() => {
    const total = visibleSteps.length
    const done = visibleSteps.filter(s => stepStatus[s.key] === 'complete').length
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  }, [visibleSteps, stepStatus])

  // Auto-jump to first incomplete step on load
  useEffect(() => {
    if (!completion) return
    const firstIncomplete = visibleSteps.find(s => stepStatus[s.key] !== 'complete')
    if (firstIncomplete) {
      setActiveStep(firstIncomplete.num)
    }
  }, []) // Only on mount

  const currentStepDef = visibleSteps.find(s => s.num === activeStep) || visibleSteps[0]

  const goNext = () => {
    refetchCompletion()
    const idx = visibleSteps.findIndex(s => s.num === activeStep)
    if (idx < visibleSteps.length - 1) {
      setActiveStep(visibleSteps[idx + 1].num)
      window.scrollTo(0, 0)
    }
  }

  const goBack = () => {
    const idx = visibleSteps.findIndex(s => s.num === activeStep)
    if (idx > 0) {
      setActiveStep(visibleSteps[idx - 1].num)
      window.scrollTo(0, 0)
    }
  }

  const goToStep = (num) => {
    setActiveStep(num)
    window.scrollTo(0, 0)
  }

  const isFirst = activeStep === visibleSteps[0]?.num
  const isLast = activeStep === visibleSteps[visibleSteps.length - 1]?.num

  const renderStep = () => {
    const props = { onNext: goNext, onBack: goBack, refetchCompletion }
    switch (currentStepDef?.key) {
      case 'profile':  return <SchoolProfileStep {...props} />
      case 'academic': return <AcademicYearStep {...props} />
      case 'session_classes': return <SessionClassesStep {...props} />
      case 'classes':  return <ClassesStep {...props} />
      case 'students': return <StudentsStep {...props} />
      case 'staff':    return <StaffStep {...props} />
      case 'subjects': return <SubjectsStep {...props} />
      case 'finance':  return <FinanceStep {...props} />
      case 'review':   return <ReviewStep completion={completion} />
      default:         return null
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">School Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeSchool?.name || 'Configure your school'} — Step {currentStepDef?.num} of {visibleSteps.length}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  wizardProgress.pct >= 100 ? 'bg-green-500' : 'bg-sky-500'
                }`}
                style={{ width: `${wizardProgress.pct}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-600">{wizardProgress.done}/{wizardProgress.total}</span>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5"
          >
            Exit Setup
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Vertical Stepper Sidebar */}
        <div className="hidden lg:block w-64 bg-white border-r min-h-[calc(100vh-8rem)] p-4 shrink-0">
          <nav className="space-y-1">
            {visibleSteps.map((step) => {
              const isActive = step.num === activeStep
              const status = stepStatus[step.key] || 'pending'
              return (
                <button
                  key={step.key}
                  onClick={() => goToStep(step.num)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    status === 'complete'
                      ? 'bg-green-100 text-green-700'
                      : status === 'partial'
                        ? 'bg-amber-100 text-amber-700'
                        : isActive
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-gray-100 text-gray-500'
                  }`}>
                    {status === 'complete' ? '✓' : step.num}
                  </span>
                  <span className="truncate">{step.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Mobile Step Indicator */}
        <div className="lg:hidden w-full bg-white border-b px-4 py-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {visibleSteps.map((step) => {
              const isActive = step.num === activeStep
              const status = stepStatus[step.key] || 'pending'
              return (
                <button
                  key={step.key}
                  onClick={() => goToStep(step.num)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-sky-100 text-sky-700'
                      : status === 'complete'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {status === 'complete' ? '✓' : step.num}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 max-w-4xl">
          {renderStep()}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t">
            <button
              onClick={goBack}
              disabled={isFirst}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                isFirst
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-600 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              ← Back
            </button>

            <div className="flex gap-2">
              {!isLast && (
                <button
                  onClick={goNext}
                  className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
                >
                  Skip
                </button>
              )}
              {!isLast ? (
                <button onClick={goNext} className="btn-primary px-5 py-2 text-sm">
                  Next Step →
                </button>
              ) : (
                <button
                  onClick={() => navigate('/dashboard')}
                  className="btn-primary px-5 py-2 text-sm"
                >
                  Go to Dashboard →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
