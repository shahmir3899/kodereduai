import { useState } from 'react'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import { useQuery } from '@tanstack/react-query'
import { admissionsApi } from '../../services/api'

const LIKELIHOOD_STYLES = {
  HIGH: TONE.success,
  MEDIUM: TONE.warning,
  LOW: TONE.neutral,
}

const LIKELIHOOD_BORDER = {
  HIGH: 'border-l-green-500',
  MEDIUM: 'border-l-amber-500',
  LOW: 'border-l-gray-400',
}

export default function ConversionLikelihoodPage() {
  const [likelihoodFilter, setLikelihoodFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['conversionLikelihood'],
    queryFn: () => admissionsApi.getConversionLikelihood(),
  })

  const result = data?.data
  const enquiries = result?.enquiries || []

  const filtered = enquiries.filter((e) => {
    if (likelihoodFilter && e.likelihood !== likelihoodFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Conversion Likelihood" subtitle="Open enquiries scored by the AI Conversion Likelihood Predictor, based on source history, response time, follow-up activity, and next-followup adherence." actions={<>
{result && (
          <div className="text-right shrink-0">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{result.total_open}</span> open enquiries scored
            </p>
          </div>
        )}
</>} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={likelihoodFilter}
          onChange={(e) => setLikelihoodFilter(e.target.value)}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="">All Likelihoods</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingState label="Loading conversion likelihood..." />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">
            {enquiries.length === 0 ? 'No open enquiries to score' : 'No enquiries match these filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => (
            <div key={e.enquiry_id} className={`card border-l-4 ${LIKELIHOOD_BORDER[e.likelihood]}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900">{e.student_name}</span>
                    <span className="text-xs text-gray-500">{e.source}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${LIKELIHOOD_STYLES[e.likelihood]}`}>
                      {e.likelihood} · {e.score}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                    <span>{e.response_detail}</span>
                    <span>{e.activity_detail}</span>
                    <span>{e.followup_detail}</span>
                  </div>
                  <p className="text-sm text-gray-800 mt-2">{e.suggested_action}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
