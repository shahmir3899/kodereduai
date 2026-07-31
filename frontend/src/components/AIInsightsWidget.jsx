import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { sessionsApi, examinationsApi, admissionsApi, hrApi, inventoryApi } from '../services/api'

const SEVERITY_STYLES = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-yellow-100 text-yellow-800',
}

const SEVERITY_DOT = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-yellow-500',
}

function SeverityBadge({ level, count }) {
  if (!count) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_STYLES[level]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[level]}`} />
      {level} {count}
    </span>
  )
}

function InsightRow({ label, href, count, riskLevels, emptyMessage }) {
  if (!count) return null
  return (
    <Link
      to={href}
      className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {emptyMessage ? (
          <p className="text-xs text-gray-500 mt-0.5">{emptyMessage}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {riskLevels?.HIGH > 0 && <SeverityBadge level="HIGH" count={riskLevels.HIGH} />}
            {riskLevels?.MEDIUM > 0 && <SeverityBadge level="MEDIUM" count={riskLevels.MEDIUM} />}
            {riskLevels?.LOW > 0 && <SeverityBadge level="LOW" count={riskLevels.LOW} />}
          </div>
        )}
      </div>
      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}

export default function AIInsightsWidget() {
  const { activeSchool, isModuleEnabled } = useAuth()
  const { activeAcademicYear, hasAcademicYear } = useAcademicYear()
  const yearReady = !!activeSchool?.id && hasAcademicYear && !!activeAcademicYear?.id

  const attendanceQuery = useQuery({
    queryKey: ['attendanceRisk', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getAttendanceRisk({ academic_year: activeAcademicYear?.id }),
    enabled: yearReady && isModuleEnabled('attendance'),
  })

  const academicQuery = useQuery({
    queryKey: ['academicRisk', activeAcademicYear?.id],
    queryFn: () => examinationsApi.getAcademicRisk({ academic_year: activeAcademicYear?.id }),
    enabled: yearReady && isModuleEnabled('examinations'),
  })

  const compositeQuery = useQuery({
    queryKey: ['studentRiskScore', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getStudentRiskScore({ academic_year: activeAcademicYear?.id }),
    enabled: yearReady && isModuleEnabled('students'),
  })

  const admissionsQuery = useQuery({
    queryKey: ['conversionLikelihood'],
    queryFn: () => admissionsApi.getConversionLikelihood(),
    enabled: !!activeSchool?.id && isModuleEnabled('admissions'),
  })

  const staffQuery = useQuery({
    queryKey: ['staffRisk'],
    queryFn: () => hrApi.getStaffRisk(),
    enabled: !!activeSchool?.id && isModuleEnabled('hr'),
  })

  const inventoryQuery = useQuery({
    queryKey: ['reorderPrediction'],
    queryFn: () => inventoryApi.getReorderPrediction(),
    enabled: !!activeSchool?.id && isModuleEnabled('inventory'),
  })

  const isLoading = [attendanceQuery, academicQuery, compositeQuery, admissionsQuery, staffQuery, inventoryQuery]
    .some((q) => q.isLoading)

  const composite = compositeQuery.data?.data
  const attendance = attendanceQuery.data?.data
  const academic = academicQuery.data?.data
  const admissions = admissionsQuery.data?.data
  const staff = staffQuery.data?.data
  const inventory = inventoryQuery.data?.data

  const goingCold = admissions?.enquiries?.filter((e) => e.likelihood === 'LOW').length || 0

  const anyData = composite?.at_risk_count || attendance?.at_risk_count || academic?.at_risk_count
    || goingCold || staff?.at_risk_count || inventory?.at_risk_count

  if (isLoading) {
    return (
      <div className="card mb-6 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-50 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!anyData) return null

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">AI Insights</h2>
        <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">
          Predictors
        </span>
      </div>

      <div className="space-y-2">
        <InsightRow
          label="Student Risk Score"
          href="/students/risk-score"
          count={composite?.at_risk_count}
          riskLevels={composite?.risk_levels}
        />
        <InsightRow
          label="Attendance Risk"
          href="/attendance/at-risk"
          count={attendance?.at_risk_count}
          riskLevels={attendance?.risk_levels}
        />
        <InsightRow
          label="Academic Risk"
          href="/academics/academic-risk"
          count={academic?.at_risk_count}
          riskLevels={academic?.risk_levels}
        />
        <InsightRow
          label="Admissions — Leads Going Cold"
          href="/admissions/conversion-likelihood"
          count={goingCold}
          emptyMessage={`${goingCold} enquir${goingCold === 1 ? 'y needs' : 'ies need'} follow-up`}
        />
        <InsightRow
          label="Staff Risk"
          href="/hr/risk"
          count={staff?.at_risk_count}
          riskLevels={staff?.risk_levels}
        />
        <InsightRow
          label="Inventory Reorder"
          href="/inventory/reorder-prediction"
          count={inventory?.at_risk_count}
          riskLevels={inventory?.risk_levels}
        />
      </div>
    </div>
  )
}
