import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { inventoryApi } from '../../services/api'

const SEVERITY_STYLES = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-yellow-100 text-yellow-800',
}

const SEVERITY_BORDER = {
  HIGH: 'border-l-red-500',
  MEDIUM: 'border-l-amber-500',
  LOW: 'border-l-yellow-500',
}

const TREND_ICONS = {
  rising: { symbol: '↑', color: 'text-red-600', label: 'Rising' },
  falling: { symbol: '↓', color: 'text-green-600', label: 'Falling' },
  stable: { symbol: '→', color: 'text-gray-500', label: 'Stable' },
}

export default function ReorderPredictionPage() {
  const [severityFilter, setSeverityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['reorderPrediction'],
    queryFn: () => inventoryApi.getReorderPrediction(),
  })

  const result = data?.data
  const items = result?.items || []

  const categoryOptions = useMemo(
    () => [...new Set(items.map((i) => i.category_name).filter(Boolean))].sort(),
    [items],
  )

  const filtered = items.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false
    if (categoryFilter && i.category_name !== categoryFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reorder Prediction</h1>
          <p className="text-sm text-gray-500 mt-1">
            Items flagged by the AI Reorder Prediction service as low on stock or projected to stock out soon,
            based on recent consumption trends.
          </p>
        </div>
        {result && (
          <div className="text-right shrink-0">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{result.at_risk_count}</span> to reorder of{' '}
              <span className="font-semibold text-gray-900">{result.total_items}</span> total
            </p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="">All Severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        {categoryOptions.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-sm border-gray-300 rounded-lg"
          >
            <option value="">All Categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-10 text-gray-500">Loading reorder predictions...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">
            {items.length === 0 ? 'No items need reordering' : 'No items match these filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((i) => {
            const trend = TREND_ICONS[i.consumption_trend] || TREND_ICONS.stable
            return (
              <div key={i.item_id} className={`card border-l-4 ${SEVERITY_BORDER[i.severity]}`}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900">{i.item_name}</span>
                      <span className="text-xs text-gray-500">{i.category_name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLES[i.severity]}`}>
                        {i.severity}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                      <span>Stock: <span className="font-semibold">{i.current_stock}</span> (min {i.minimum_stock})</span>
                      <span className={`inline-flex items-center gap-0.5 font-medium ${trend.color}`}>
                        {trend.symbol} {trend.label}
                      </span>
                      {i.days_until_stockout != null && (
                        <span>Stockout in: <span className="font-semibold">{i.days_until_stockout} days</span></span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 mt-2">{i.suggested_action}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
