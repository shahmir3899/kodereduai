import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { classesApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { GRADE_PRESETS, GRADE_LEVEL_LABELS } from '../../constants/gradePresets'

const EMPTY_CLASS = { name: '', section: '', grade_level: '' }
const SECTION_LABELS = ['A', 'B', 'C', 'D', 'E']

export default function ClassesStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [form, setForm] = useState(EMPTY_CLASS)
  const [errors, setErrors] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [quickMode, setQuickMode] = useState(false)
  const [selectedPresets, setSelectedPresets] = useState([])

  const { data: classesRes, isLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 200 }),
  })

  const classes = classesRes?.data?.results || classesRes?.data || []

  const createMut = useMutation({
    mutationFn: (data) => classesApi.createClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      refetchCompletion()
      addToast('Class added!', 'success')
      setForm(EMPTY_CLASS)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const bulkCreateMut = useMutation({
    mutationFn: async (presets) => {
      const results = []
      for (const p of presets) {
        try {
          const res = await classesApi.createClass({
            name: p.name,
            section: 'A',
            grade_level: p.numeric_level,
          })
          results.push(res)
        } catch (err) {
          // Skip duplicates silently
        }
      }
      return results
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      refetchCompletion()
      addToast(`${results.length} classes created!`, 'success')
      setQuickMode(false)
      setSelectedPresets([])
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id) => classesApi.deleteClass(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      refetchCompletion()
      addToast('Class removed', 'success')
    },
    onError: (err) => addToast(err.response?.data?.detail || 'Cannot delete', 'error'),
  })

  const handleCreate = () => {
    const e = {}
    if (!form.name.trim()) e.name = ['Name is required']
    if (form.grade_level === '') e.grade_level = ['Grade level is required']
    if (Object.keys(e).length) { setErrors(e); return }
    createMut.mutate(form)
  }

  const togglePreset = (p) => {
    setSelectedPresets(prev =>
      prev.find(x => x.numeric_level === p.numeric_level)
        ? prev.filter(x => x.numeric_level !== p.numeric_level)
        : [...prev, p]
    )
  }

  // Group classes by grade level
  const grouped = classes.reduce((acc, c) => {
    const key = c.grade_level ?? 'other'
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Classes & Grades</h2>
      <p className="text-sm text-gray-500 mb-6">
        Add your classes. You need at least 3 classes to proceed.
        <span className="ml-2 text-gray-400">({classes.length} created)</span>
      </p>

      {/* Quick Add from Presets */}
      {classes.length === 0 && !showForm && (
        <div className="bg-sky-50 rounded-xl border border-sky-200 p-5 mb-6">
          <h3 className="text-sm font-medium text-sky-800 mb-2">Quick Setup</h3>
          <p className="text-xs text-sky-600 mb-3">Select the grade levels your school offers:</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {GRADE_PRESETS.map(p => {
              const selected = selectedPresets.find(x => x.numeric_level === p.numeric_level)
              return (
                <button
                  key={p.numeric_level}
                  onClick={() => togglePreset(p)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    selected
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-sky-400'
                  }`}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => bulkCreateMut.mutate(selectedPresets)}
              disabled={selectedPresets.length === 0 || bulkCreateMut.isPending}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {bulkCreateMut.isPending ? 'Creating...' : `Create ${selectedPresets.length} Classes`}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="text-sm text-gray-600 hover:text-gray-800 px-3 py-2"
            >
              Or add manually
            </button>
          </div>
        </div>
      )}

      {/* Existing Classes */}
      {classes.length > 0 && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Your Classes</h3>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs text-sky-600 hover:text-sky-700"
            >
              + Add Class
            </button>
          </div>
          <div className="space-y-1.5">
            {Object.entries(grouped)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([level, items]) => (
                <div key={level} className="flex items-center gap-2 py-1.5 px-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-800 w-28">
                    {GRADE_LEVEL_LABELS[level] || `Grade ${level}`}
                  </span>
                  <div className="flex gap-1.5 flex-wrap flex-1">
                    {items.map(c => (
                      <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border rounded text-xs text-gray-600">
                        {c.section || 'A'}
                        <button
                          onClick={() => deleteMut.mutate(c.id)}
                          className="text-gray-400 hover:text-red-500 ml-0.5"
                          title="Remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Manual Add Form */}
      {(showForm || (classes.length > 0 && showForm)) && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Add Class</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Grade Level</label>
              <select
                className="input"
                value={form.grade_level}
                onChange={e => {
                  const gl = e.target.value
                  const preset = GRADE_PRESETS.find(p => String(p.numeric_level) === gl)
                  setForm(p => ({ ...p, grade_level: gl, name: preset?.name || p.name }))
                  setErrors({})
                }}
              >
                <option value="">Select grade</option>
                {GRADE_PRESETS.map(p => (
                  <option key={p.numeric_level} value={p.numeric_level}>{p.name}</option>
                ))}
              </select>
              {errors.grade_level && <p className="text-xs text-red-600 mt-1">{errors.grade_level[0]}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Class Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Class 1"
                value={form.name}
                onChange={e => { setForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
              />
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Section</label>
              <select
                className="input"
                value={form.section}
                onChange={e => setForm(p => ({ ...p, section: e.target.value }))}
              >
                <option value="">None</option>
                {SECTION_LABELS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              disabled={createMut.isPending}
              className="btn-primary px-4 py-1.5 text-sm"
            >
              {createMut.isPending ? 'Adding...' : 'Add Class'}
            </button>
            <button
              onClick={() => { setShowForm(false); setErrors({}) }}
              className="text-sm text-gray-500 px-3 py-1.5"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Status hint */}
      {classes.length > 0 && classes.length < 3 && (
        <p className="text-xs text-amber-600 mt-3">Add at least {3 - classes.length} more class(es) to complete this step.</p>
      )}
    </div>
  )
}
