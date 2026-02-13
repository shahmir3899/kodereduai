import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { admissionsApi } from '../../services/api'
import { GRADE_LEVEL_LABELS } from '../../constants/gradePresets'

const STAGES = [
  { key: 'NEW', label: 'New', color: 'bg-blue-500' },
  { key: 'CONTACTED', label: 'Contacted', color: 'bg-indigo-500' },
  { key: 'VISIT_SCHEDULED', label: 'Visit Scheduled', color: 'bg-purple-500' },
  { key: 'VISIT_DONE', label: 'Visit Done', color: 'bg-purple-600' },
  { key: 'FORM_SUBMITTED', label: 'Form Submitted', color: 'bg-orange-500' },
  { key: 'TEST_SCHEDULED', label: 'Test Scheduled', color: 'bg-amber-500' },
  { key: 'TEST_DONE', label: 'Test Done', color: 'bg-amber-600' },
  { key: 'OFFERED', label: 'Offered', color: 'bg-emerald-500' },
  { key: 'ACCEPTED', label: 'Accepted', color: 'bg-green-500' },
  { key: 'ENROLLED', label: 'Enrolled', color: 'bg-teal-500' },
]

const STAGE_BADGE_COLORS = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-indigo-100 text-indigo-800',
  VISIT_SCHEDULED: 'bg-purple-100 text-purple-800',
  VISIT_DONE: 'bg-purple-100 text-purple-800',
  FORM_SUBMITTED: 'bg-orange-100 text-orange-800',
  TEST_SCHEDULED: 'bg-amber-100 text-amber-800',
  TEST_DONE: 'bg-amber-100 text-amber-800',
  OFFERED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  ENROLLED: 'bg-teal-100 text-teal-800',
  REJECTED: 'bg-red-100 text-red-800',
  WITHDRAWN: 'bg-gray-100 text-gray-800',
  LOST: 'bg-gray-100 text-gray-600',
}

export default function AdmissionDashboard() {
  const { user } = useAuth()

  // Pipeline analytics
  const { data: analyticsRes, isLoading: analyticsLoading } = useQuery({
    queryKey: ['admissionPipeline'],
    queryFn: () => admissionsApi.getPipelineAnalytics(),
  })

  // Today's followups
  const { data: todayFollowupsRes } = useQuery({
    queryKey: ['todayFollowups'],
    queryFn: () => admissionsApi.getTodayFollowups(),
  })

  // Overdue followups
  const { data: overdueFollowupsRes } = useQuery({
    queryKey: ['overdueFollowups'],
    queryFn: () => admissionsApi.getOverdueFollowups(),
  })

  // Recent enquiries
  const { data: recentEnquiriesRes } = useQuery({
    queryKey: ['enquiries', { ordering: '-created_at', page_size: 5 }],
    queryFn: () => admissionsApi.getEnquiries({ ordering: '-created_at', page_size: 5 }),
  })

  const analytics = analyticsRes?.data || {}
  const pipeline = analytics.pipeline || {}
  const sourceBreakdown = analytics.source_breakdown || []
  const todayFollowups = todayFollowupsRes?.data?.results || todayFollowupsRes?.data || []
  const overdueFollowups = overdueFollowupsRes?.data?.results || overdueFollowupsRes?.data || []
  const recentEnquiries = recentEnquiriesRes?.data?.results || recentEnquiriesRes?.data || []

  // Calculate stats
  const totalEnquiries = analytics.total_enquiries || Object.values(pipeline).reduce((sum, v) => sum + (v || 0), 0) || 0
  const enrolledCount = pipeline.ENROLLED || 0
  const conversionRate = totalEnquiries > 0 ? Math.round((enrolledCount / totalEnquiries) * 100) : 0

  // Find max count for funnel width
  const maxCount = Math.max(...STAGES.map(s => pipeline[s.key] || 0), 1)

  if (analyticsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Admission CRM</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage your admission pipeline and enquiries</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admissions/enquiries?filter=followup_today"
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Today's Followups
          </Link>
          <Link
            to="/admissions/enquiries/new"
            className="btn-primary text-sm px-4 py-2 inline-flex items-center"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Enquiry
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Total Enquiries</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalEnquiries}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Conversion Rate</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{conversionRate}%</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Today's Followups</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{Array.isArray(todayFollowups) ? todayFollowups.length : 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Overdue Followups</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{Array.isArray(overdueFollowups) ? overdueFollowups.length : 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Pipeline Funnel */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Admission Pipeline</h2>
          <div className="space-y-2">
            {STAGES.map((stage) => {
              const count = pipeline[stage.key] || 0
              const widthPercent = maxCount > 0 ? Math.max((count / maxCount) * 100, 4) : 4
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="w-28 sm:w-36 text-xs sm:text-sm text-gray-600 text-right flex-shrink-0 truncate">
                    {stage.label}
                  </div>
                  <div className="flex-1 h-7 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${stage.color} rounded-full flex items-center justify-end pr-2 transition-all duration-500`}
                      style={{ width: `${widthPercent}%`, minWidth: '28px' }}
                    >
                      <span className="text-white text-xs font-semibold">{count}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100">
            <Link
              to="/admissions/enquiries"
              className="text-sm text-primary-600 hover:text-primary-700 font-medium inline-flex items-center"
            >
              View all enquiries
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Source Breakdown */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Enquiry Sources</h2>
          {sourceBreakdown.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">No data available</p>
          ) : (
            <div className="space-y-3">
              {sourceBreakdown.map((item) => {
                const sourceTotal = sourceBreakdown.reduce((sum, s) => sum + (s.count || 0), 0)
                const pct = sourceTotal > 0 ? Math.round(((item.count || 0) / sourceTotal) * 100) : 0
                return (
                  <div key={item.source || item.name || 'unknown'}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 capitalize">{(item.source || item.name || 'Unknown').replace(/_/g, ' ').toLowerCase()}</span>
                      <span className="text-gray-900 font-medium">{item.count || 0}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Enquiries */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Enquiries</h2>
          <Link to="/admissions/enquiries" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            View All
          </Link>
        </div>

        {recentEnquiries.length === 0 ? (
          <p className="text-center py-6 text-gray-500 text-sm">No enquiries yet. Start by adding a new enquiry.</p>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-2">
              {recentEnquiries.slice(0, 5).map((enquiry) => (
                <Link
                  key={enquiry.id}
                  to={`/admissions/enquiries/${enquiry.id}`}
                  className="block p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm text-gray-900 truncate">{enquiry.child_name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${STAGE_BADGE_COLORS[enquiry.stage] || 'bg-gray-100 text-gray-700'}`}>
                      {(enquiry.stage || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{enquiry.parent_name} | {enquiry.parent_phone}</p>
                  <p className="text-xs text-gray-400 mt-1">{GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'N/A'} | {enquiry.source}</p>
                </Link>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Child Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Parent</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Grade</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentEnquiries.slice(0, 5).map((enquiry) => (
                    <tr key={enquiry.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/admissions/enquiries/${enquiry.id}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{enquiry.child_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{enquiry.parent_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{enquiry.parent_phone}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STAGE_BADGE_COLORS[enquiry.stage] || 'bg-gray-100 text-gray-700'}`}>
                          {(enquiry.stage || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 capitalize">{(enquiry.source || '').replace(/_/g, ' ').toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
