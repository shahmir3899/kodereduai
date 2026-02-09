import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schoolsApi, attendanceApi } from '../services/api'

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('mappings')

  // Mark Mappings State
  const [mappings, setMappings] = useState({
    PRESENT: ['P', 'p', '✓', '✔', '/', '1'],
    ABSENT: ['A', 'a', '✗', '✘', 'X', 'x', '0', '-'],
    LATE: ['L', 'l'],
    LEAVE: ['Le', 'LE', 'le'],
    default: 'ABSENT'
  })
  const [newSymbol, setNewSymbol] = useState({ status: 'PRESENT', symbol: '' })

  // Register Config State
  const [regConfig, setRegConfig] = useState({
    orientation: 'rows_are_students',
    date_header_row: 0,
    student_name_col: 0,
    roll_number_col: 1,
    data_start_row: 1,
    data_start_col: 2
  })

  // Fetch current mappings
  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ['markMappings'],
    queryFn: () => schoolsApi.getMarkMappings()
  })

  // Fetch register config
  const { data: regConfigData, isLoading: regConfigLoading } = useQuery({
    queryKey: ['registerConfig'],
    queryFn: () => schoolsApi.getRegisterConfig()
  })

  // Fetch mapping suggestions
  const { data: suggestionsData } = useQuery({
    queryKey: ['mappingSuggestions'],
    queryFn: () => attendanceApi.getMappingSuggestions({})
  })

  // Update state when data loads
  useEffect(() => {
    if (mappingsData?.data?.mark_mappings) {
      setMappings(mappingsData.data.mark_mappings)
    }
  }, [mappingsData])

  useEffect(() => {
    if (regConfigData?.data?.register_config) {
      setRegConfig(regConfigData.data.register_config)
    }
  }, [regConfigData])

  // Save mappings mutation
  const saveMappingsMutation = useMutation({
    mutationFn: (data) => schoolsApi.updateMarkMappings(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['markMappings'])
      queryClient.invalidateQueries(['mappingSuggestions'])
    }
  })

  // Save register config mutation
  const saveRegConfigMutation = useMutation({
    mutationFn: (data) => schoolsApi.updateRegisterConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['registerConfig'])
    }
  })

  // Add symbol to a status
  const addSymbol = () => {
    if (!newSymbol.symbol.trim()) return

    const status = newSymbol.status
    const symbol = newSymbol.symbol.trim()

    if (!mappings[status]?.includes(symbol)) {
      setMappings(prev => ({
        ...prev,
        [status]: [...(prev[status] || []), symbol]
      }))
    }
    setNewSymbol({ ...newSymbol, symbol: '' })
  }

  // Remove symbol from a status
  const removeSymbol = (status, symbol) => {
    setMappings(prev => ({
      ...prev,
      [status]: prev[status].filter(s => s !== symbol)
    }))
  }

  // Apply suggestion
  const applySuggestion = (mark, suggestedStatus) => {
    if (!mappings[suggestedStatus]?.includes(mark)) {
      setMappings(prev => ({
        ...prev,
        [suggestedStatus]: [...(prev[suggestedStatus] || []), mark]
      }))
    }
  }

  const suggestions = suggestionsData?.data?.suggestions || []

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm sm:text-base text-gray-600">Configure how attendance marks are interpreted</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-4 sm:space-x-8 overflow-x-auto">
          <button
            onClick={() => setActiveTab('mappings')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'mappings'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Mark Mappings
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'register'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Register Layout
          </button>
        </nav>
      </div>

      {/* Mark Mappings Tab */}
      {activeTab === 'mappings' && (
        <div className="space-y-6">
          {mappingsLoading ? (
            <div className="card text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : (
            <>
              {/* Suggestions from Learning */}
              {suggestions.length > 0 && (
                <div className="card bg-blue-50 border-blue-200">
                  <h3 className="font-medium text-blue-800 mb-3 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Suggestions Based on OCR Errors
                  </h3>
                  <div className="space-y-2">
                    {suggestions.slice(0, 5).map((s, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white p-2 rounded-lg">
                        <div>
                          <span className="font-mono bg-gray-100 px-2 py-1 rounded">"{s.mark}"</span>
                          <span className="text-sm text-gray-600 ml-2">
                            misread {s.misread_count} times
                          </span>
                          {s.current_mapping !== 'Not mapped (using default)' && (
                            <span className="text-xs text-gray-500 ml-2">
                              (currently: {s.current_mapping})
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => applySuggestion(s.mark, 'PRESENT')}
                            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                          >
                            Add to PRESENT
                          </button>
                          <button
                            onClick={() => applySuggestion(s.mark, 'ABSENT')}
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Add to ABSENT
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Current Mappings */}
              <div className="card">
                <h3 className="font-medium text-gray-900 mb-4">Current Mark Mappings</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Define which symbols in handwritten registers map to each attendance status.
                </p>

                <div className="space-y-4">
                  {['PRESENT', 'ABSENT', 'LATE', 'LEAVE'].map(status => (
                    <div key={status} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className={`font-medium ${
                          status === 'PRESENT' ? 'text-green-700' :
                          status === 'ABSENT' ? 'text-red-700' :
                          status === 'LATE' ? 'text-yellow-700' :
                          'text-blue-700'
                        }`}>
                          {status}
                        </span>
                        <span className="text-sm text-gray-500">
                          {mappings[status]?.length || 0} symbols
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {mappings[status]?.map((symbol, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                          >
                            <span className="font-mono">{symbol}</span>
                            <button
                              onClick={() => removeSymbol(status, symbol)}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                        {(!mappings[status] || mappings[status].length === 0) && (
                          <span className="text-sm text-gray-400 italic">No symbols defined</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Default for blank/unknown */}
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Default for blank/unrecognized marks:
                  </label>
                  <select
                    value={mappings.default || 'ABSENT'}
                    onChange={(e) => setMappings(prev => ({ ...prev, default: e.target.value }))}
                    className="input w-full sm:w-48"
                  >
                    <option value="PRESENT">PRESENT</option>
                    <option value="ABSENT">ABSENT</option>
                    <option value="LATE">LATE</option>
                    <option value="LEAVE">LEAVE</option>
                  </select>
                </div>

                {/* Add new symbol */}
                <div className="mt-6 p-4 border border-dashed border-gray-300 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Add New Symbol</h4>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <select
                      value={newSymbol.status}
                      onChange={(e) => setNewSymbol({ ...newSymbol, status: e.target.value })}
                      className="input w-full sm:w-40"
                    >
                      <option value="PRESENT">PRESENT</option>
                      <option value="ABSENT">ABSENT</option>
                      <option value="LATE">LATE</option>
                      <option value="LEAVE">LEAVE</option>
                    </select>
                    <input
                      type="text"
                      value={newSymbol.symbol}
                      onChange={(e) => setNewSymbol({ ...newSymbol, symbol: e.target.value })}
                      placeholder="Symbol (e.g., P, ✓, A)"
                      className="input flex-1"
                      maxLength={5}
                    />
                    <button
                      onClick={addSymbol}
                      className="btn btn-secondary"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Save Button */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => saveMappingsMutation.mutate(mappings)}
                    disabled={saveMappingsMutation.isPending}
                    className="btn btn-primary"
                  >
                    {saveMappingsMutation.isPending ? 'Saving...' : 'Save Mark Mappings'}
                  </button>
                </div>

                {saveMappingsMutation.isSuccess && (
                  <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
                    Mark mappings saved successfully!
                  </div>
                )}
                {saveMappingsMutation.isError && (
                  <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    Failed to save: {saveMappingsMutation.error?.response?.data?.error || 'Unknown error'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Register Layout Tab */}
      {activeTab === 'register' && (
        <div className="card">
          {regConfigLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : (
            <>
              <h3 className="font-medium text-gray-900 mb-4">Register Layout Configuration</h3>
              <p className="text-sm text-gray-500 mb-6">
                Configure how the AI interprets your attendance register format.
              </p>

              <div className="space-y-6">
                {/* Orientation */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Register Orientation
                  </label>
                  <select
                    value={regConfig.orientation}
                    onChange={(e) => setRegConfig(prev => ({ ...prev, orientation: e.target.value }))}
                    className="input w-full"
                  >
                    <option value="rows_are_students">Rows are students, columns are dates</option>
                    <option value="columns_are_students">Columns are students, rows are dates</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Most registers have students in rows and dates across columns.
                  </p>
                </div>

                {/* Grid Layout */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date Header Row
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={regConfig.date_header_row}
                      onChange={(e) => setRegConfig(prev => ({ ...prev, date_header_row: parseInt(e.target.value) || 0 }))}
                      className="input w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500">Row containing date numbers (0-indexed)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Data Start Row
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={regConfig.data_start_row}
                      onChange={(e) => setRegConfig(prev => ({ ...prev, data_start_row: parseInt(e.target.value) || 0 }))}
                      className="input w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500">First row with student attendance data</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Student Name Column
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={regConfig.student_name_col}
                      onChange={(e) => setRegConfig(prev => ({ ...prev, student_name_col: parseInt(e.target.value) || 0 }))}
                      className="input w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500">Column with student names (0-indexed)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Roll Number Column
                    </label>
                    <input
                      type="number"
                      min="-1"
                      value={regConfig.roll_number_col}
                      onChange={(e) => setRegConfig(prev => ({ ...prev, roll_number_col: parseInt(e.target.value) || 0 }))}
                      className="input w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500">Column with roll numbers (-1 if none)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Data Start Column
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={regConfig.data_start_col}
                      onChange={(e) => setRegConfig(prev => ({ ...prev, data_start_col: parseInt(e.target.value) || 0 }))}
                      className="input w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500">First column with attendance marks</p>
                  </div>
                </div>

                {/* Visual Preview */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Preview Layout</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs border border-gray-300">
                      <tbody>
                        {[0, 1, 2, 3].map(row => (
                          <tr key={row}>
                            {[0, 1, 2, 3, 4, 5].map(col => {
                              const isHeader = row === regConfig.date_header_row
                              const isNameCol = col === regConfig.student_name_col
                              const isRollCol = col === regConfig.roll_number_col
                              const isDataArea = row >= regConfig.data_start_row && col >= regConfig.data_start_col

                              let content = ''
                              let bgColor = 'bg-white'

                              if (isHeader && col >= regConfig.data_start_col) {
                                content = `Day ${col - regConfig.data_start_col + 1}`
                                bgColor = 'bg-blue-100'
                              } else if (isNameCol && row >= regConfig.data_start_row) {
                                content = `Name ${row}`
                                bgColor = 'bg-green-100'
                              } else if (isRollCol && row >= regConfig.data_start_row) {
                                content = `${row}`
                                bgColor = 'bg-yellow-100'
                              } else if (isDataArea) {
                                content = 'P/A'
                                bgColor = 'bg-gray-100'
                              }

                              return (
                                <td
                                  key={col}
                                  className={`border border-gray-300 p-2 text-center ${bgColor}`}
                                >
                                  {content}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 sm:gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-blue-100 border"></span> Date Header
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-green-100 border"></span> Name Column
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-yellow-100 border"></span> Roll Column
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-gray-100 border"></span> Attendance Data
                    </span>
                  </div>
                </div>

                {/* Save Button */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => saveRegConfigMutation.mutate(regConfig)}
                    disabled={saveRegConfigMutation.isPending}
                    className="btn btn-primary"
                  >
                    {saveRegConfigMutation.isPending ? 'Saving...' : 'Save Register Configuration'}
                  </button>
                </div>

                {saveRegConfigMutation.isSuccess && (
                  <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
                    Register configuration saved successfully!
                  </div>
                )}
                {saveRegConfigMutation.isError && (
                  <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    Failed to save: {saveRegConfigMutation.error?.response?.data?.error || 'Unknown error'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
