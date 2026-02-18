import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { schoolsApi } from '../services/api'

function SkeletonCard() {
  return (
    <div className="card mb-6 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="w-20 h-20 rounded-full bg-gray-100 shrink-0 mx-auto sm:mx-0" />
        <div className="flex-1 space-y-2.5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-50 rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}

function DonutChart({ percentage }) {
  const radius = 34
  const stroke = 6
  const center = 40
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference
  const color = percentage === 100
    ? '#22c55e'
    : percentage >= 50
      ? '#3b82f6'
      : '#f59e0b'

  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
      <circle
        cx={center} cy={center} r={radius}
        fill="none" stroke="#e5e7eb" strokeWidth={stroke}
      />
      <circle
        cx={center} cy={center} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
        className="transition-all duration-700"
      />
      <text
        x={center} y={center}
        textAnchor="middle" dominantBaseline="central"
        className="fill-gray-900 text-lg font-bold"
        style={{ fontSize: '18px', fontWeight: 700 }}
      >
        {percentage}%
      </text>
    </svg>
  )
}

function ModuleBar({ module, onClick }) {
  const color = module.percentage === 100
    ? 'bg-green-500'
    : module.percentage >= 50
      ? 'bg-blue-500'
      : 'bg-amber-500'

  const tooltip = module.steps
    .map(s => `${s.completed ? '\u2713' : '\u2717'} ${s.name}${s.completed ? ` (${s.count})` : ''}`)
    .join('\n')

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className="w-full flex items-center gap-2 py-1 group hover:bg-gray-50 rounded px-1 -mx-1 transition-colors"
    >
      <span className="text-xs text-gray-700 w-28 sm:w-36 text-left truncate group-hover:text-blue-600 transition-colors">
        {module.label}
      </span>
      <div className="flex-1 bg-gray-200 rounded-full h-1.5 min-w-0">
        <div
          className={`${color} h-1.5 rounded-full transition-all duration-500`}
          style={{ width: `${module.percentage}%` }}
        />
      </div>
      <span className={`text-xs font-medium w-8 text-right tabular-nums ${
        module.percentage === 100 ? 'text-green-600' : 'text-gray-500'
      }`}>
        {module.percentage}%
      </span>
    </button>
  )
}

export default function SchoolCompletionWidget() {
  const { isSchoolAdmin, activeSchool } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['schoolCompletion', activeSchool?.id],
    queryFn: () => schoolsApi.getCompletion(),
    enabled: !!activeSchool?.id && isSchoolAdmin,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  })

  if (!isSchoolAdmin) return null
  if (isLoading) return <SkeletonCard />

  const completion = data?.data
  if (!completion) return null

  if (completion.overall_percentage === 100) {
    return (
      <div className="card mb-6 flex items-center gap-3 bg-green-50 border border-green-200">
        <svg className="w-5 h-5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <p className="text-sm font-medium text-green-800">All modules fully set up!</p>
      </div>
    )
  }

  const handleModuleClick = (module) => {
    const incompleteStep = module.steps.find(s => !s.completed)
    navigate(incompleteStep ? incompleteStep.link : module.steps[0].link)
  }

  return (
    <div className="card mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">School Setup Progress</h2>

      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
        {/* Donut chart */}
        <div className="flex flex-col items-center gap-1.5">
          <DonutChart percentage={completion.overall_percentage} />
          <p className="text-xs text-gray-500">
            {completion.completed_steps}/{completion.total_steps} steps
          </p>
        </div>

        {/* Module bars */}
        <div className="flex-1 w-full min-w-0 space-y-0.5">
          {completion.modules.map((module) => (
            <ModuleBar
              key={module.key}
              module={module}
              onClick={() => handleModuleClick(module)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
