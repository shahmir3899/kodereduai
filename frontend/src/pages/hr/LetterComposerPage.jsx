import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { letterComposerApi, hrApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'

// ============================================
// MARKUP PREVIEW HELPER
// ============================================
function parseToHTML(text) {
  if (!text) return ''
  return text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/~(.*?)~/g, '<s>$1</s>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/```(.*?)```/g, '<code class="bg-gray-200 px-1 rounded text-sm font-mono">$1</code>')
    .replace(/^\s*[-*]\s+(.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\s*(\d+)\.\s+(.*)$/gm, '<li class="ml-4 list-decimal" value="$1">$2</li>')
    .replace(/\n/g, '<br>')
}

// ============================================
// COMPONENT
// ============================================
export default function LetterComposerPage() {
  const { user } = useAuth()
  const { showSuccess, showError } = useToast()
  const queryClient = useQueryClient()
  const textareaRef = useRef(null)

  // Form state
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [lineSpacing, setLineSpacing] = useState('single')
  const [templateType, setTemplateType] = useState('custom')

  // Recipient picker
  const [recipientMode, setRecipientMode] = useState('custom') // custom | school | employee
  const [showPicker, setShowPicker] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null)

  // History
  const [selectedLetter, setSelectedLetter] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  // PDF generation
  const [isGenerating, setIsGenerating] = useState(false)

  // AI Drafting
  const [showAIDrafter, setShowAIDrafter] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [isAIDrafting, setIsAIDrafting] = useState(false)

  // ============================================
  // QUERIES
  // ============================================
  const { data: lettersRes, isLoading: loadingLetters } = useQuery({
    queryKey: ['customLetters'],
    queryFn: () => letterComposerApi.getLetters({ limit: 50 }),
  })
  const letters = lettersRes?.data || []

  const { data: templatesRes } = useQuery({
    queryKey: ['letterTemplates'],
    queryFn: () => letterComposerApi.getTemplates(),
  })
  const templates = templatesRes?.data || {}

  // Schools come from the user's auth context (no extra API call needed)
  const schools = user?.schools || []
  const loadingSchools = false

  const { data: staffRes, isLoading: loadingStaff } = useQuery({
    queryKey: ['staffList'],
    queryFn: () => hrApi.getStaff({ page_size: 200, employment_status: 'ACTIVE' }),
    enabled: recipientMode === 'employee' && showPicker,
  })
  const employees = staffRes?.data?.results || staffRes?.data || []

  // ============================================
  // MUTATIONS
  // ============================================
  const saveMutation = useMutation({
    mutationFn: (data) => letterComposerApi.createLetter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customLetters'] })
      showSuccess('Letter saved to history')
    },
    onError: () => showError('Failed to save letter'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => letterComposerApi.updateLetter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customLetters'] })
      showSuccess('Letter updated')
    },
    onError: () => showError('Failed to update letter'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => letterComposerApi.deleteLetter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customLetters'] })
      showSuccess('Letter deleted')
    },
    onError: () => showError('Failed to delete letter'),
  })

  // ============================================
  // ACTIONS
  // ============================================
  const clearForm = useCallback(() => {
    setRecipient('')
    setSubject('')
    setBodyText('')
    setLineSpacing('single')
    setTemplateType('custom')
    setRecipientMode('custom')
    setSelectedEmployeeId(null)
    setSelectedLetter(null)
    setShowPicker(false)
  }, [])

  const getLetterPayload = useCallback(() => ({
    recipient,
    subject,
    body_text: bodyText,
    line_spacing: lineSpacing,
    template_type: templateType,
  }), [recipient, subject, bodyText, lineSpacing, templateType])

  const applyTemplate = useCallback(async (key) => {
    setTemplateType(key)
    if (key === 'custom' || !templates[key]) return

    const t = templates[key]
    let newSubject = t.default_subject || ''
    let newBody = t.default_body || ''

    // Prefill with employee data if selected
    if (selectedEmployeeId) {
      try {
        const subRes = await letterComposerApi.prefillTemplate({
          template_body: newSubject,
          employee_id: selectedEmployeeId,
        })
        newSubject = subRes.data.prefilled_body || newSubject

        const bodyRes = await letterComposerApi.prefillTemplate({
          template_body: newBody,
          employee_id: selectedEmployeeId,
        })
        newBody = bodyRes.data.prefilled_body || newBody
      } catch {
        // Use unprefilled template
      }
    }

    setSubject(newSubject)
    setBodyText(newBody)
    setSelectedLetter(null)
    showSuccess(`Template "${t.name}" applied`)
  }, [templates, selectedEmployeeId])

  const selectRecipient = useCallback((type, value, empId = null) => {
    setRecipient(value)
    setRecipientMode(type)
    setSelectedEmployeeId(type === 'employee' ? empId : null)
    setShowPicker(false)
  }, [])

  const loadLetter = useCallback(async (id) => {
    try {
      const res = await letterComposerApi.getLetter(id)
      const l = res.data
      setRecipient(l.recipient)
      setSubject(l.subject)
      setBodyText(l.body_text)
      setLineSpacing(l.line_spacing)
      setTemplateType(l.template_type)
      setSelectedLetter(l)
      showSuccess('Letter loaded')
    } catch {
      showError('Failed to load letter')
    }
  }, [])

  const handleDelete = useCallback(async (id) => {
    if (deleteConfirmId === id) {
      await deleteMutation.mutateAsync(id)
      if (selectedLetter?.id === id) clearForm()
      setDeleteConfirmId(null)
    } else {
      setDeleteConfirmId(id)
      setTimeout(() => setDeleteConfirmId(null), 3000)
    }
  }, [deleteConfirmId, deleteMutation, selectedLetter, clearForm])

  const handleGenerate = useCallback(async () => {
    if (!recipient.trim() || !subject.trim() || !bodyText.trim()) {
      showError('All fields are required')
      return
    }
    // If loaded from history, ask update or new
    if (selectedLetter) {
      setShowUpdateDialog(true)
      return
    }
    await executeGeneration(false)
  }, [recipient, subject, bodyText, selectedLetter])

  const executeGeneration = useCallback(async (shouldUpdate) => {
    setIsGenerating(true)
    try {
      const res = await letterComposerApi.generatePDF({
        recipient,
        subject,
        body_text: bodyText,
        line_spacing: lineSpacing,
      })

      // Download the blob
      const blob = new Blob([res.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Letter_${subject.replace(/\s+/g, '_').slice(0, 50)}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showSuccess('PDF generated!')

      // Save or update
      if (shouldUpdate && selectedLetter) {
        await updateMutation.mutateAsync({ id: selectedLetter.id, data: getLetterPayload() })
      } else {
        await saveMutation.mutateAsync(getLetterPayload())
      }

      setShowUpdateDialog(false)
      clearForm()
    } catch (err) {
      showError('Failed to generate PDF')
      setShowUpdateDialog(false)
    } finally {
      setIsGenerating(false)
    }
  }, [recipient, subject, bodyText, lineSpacing, selectedLetter, getLetterPayload, updateMutation, saveMutation, clearForm])

  // ============================================
  // AI DRAFTING
  // ============================================
  const handleAIDraft = useCallback(async () => {
    if (!aiPrompt.trim()) {
      showError('Please describe the letter you want to draft')
      return
    }
    setIsAIDrafting(true)
    try {
      let employeeContext = null
      if (selectedEmployeeId && employees.length > 0) {
        const emp = employees.find(e => e.id === selectedEmployeeId)
        if (emp) {
          employeeContext = {
            name: emp.full_name || `${emp.first_name} ${emp.last_name}`.trim(),
            employee_id: emp.employee_id || '',
            department: emp.department_name || emp.department?.name || '',
            designation: emp.designation_name || emp.designation?.name || '',
            date_of_joining: emp.date_of_joining || '',
          }
        }
      }

      const res = await letterComposerApi.aiDraft({
        prompt: aiPrompt,
        template_type: templateType !== 'custom' ? templateType : '',
        employee_context: employeeContext,
      })

      const { subject: newSubject, body_text: newBody, fallback } = res.data
      if (newSubject) setSubject(newSubject)
      if (newBody) setBodyText(newBody)
      setSelectedLetter(null)

      if (fallback) {
        showSuccess('AI unavailable — loaded a template instead. Edit as needed.')
      } else {
        showSuccess('Letter drafted by AI! Review and edit as needed.')
      }
      setShowAIDrafter(false)
      setAiPrompt('')
    } catch (err) {
      showError(err.response?.data?.error || 'AI drafting failed. Please try again.')
    } finally {
      setIsAIDrafting(false)
    }
  }, [aiPrompt, templateType, selectedEmployeeId, employees])

  // ============================================
  // TEXT FORMATTING
  // ============================================
  const formatText = useCallback((type) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = bodyText.slice(start, end)
    let replacement = selected
    let marker

    switch (type) {
      case 'bold': marker = '*'; replacement = `${marker}${selected}${marker}`; break
      case 'italic': marker = '_'; replacement = `${marker}${selected}${marker}`; break
      case 'strike': marker = '~'; replacement = `${marker}${selected}${marker}`; break
      case 'mono': marker = '```'; replacement = `${marker}${selected}${marker}`; break
      case 'bullet':
        replacement = selected
          ? selected.split('\n').map(l => l ? `- ${l}` : '').join('\n')
          : '- '
        break
      case 'number':
        replacement = selected
          ? selected.split('\n').map((l, i) => l ? `${i + 1}. ${l}` : '').join('\n')
          : '1. '
        break
      default: return
    }

    const newText = bodyText.slice(0, start) + replacement + bodyText.slice(end)
    setBodyText(newText)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + replacement.length
    }, 0)
  }, [bodyText])

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString('en-PK', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  // Template options
  const templateOptions = [
    { value: 'custom', label: 'Custom Letter' },
    ...Object.entries(templates).map(([k, v]) => ({ value: k, label: v.name })),
  ]

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Letter Composer</h1>
        <p className="text-sm text-gray-600">Create official letters on your school letterhead</p>
      </div>

      {/* Update/Create Modal */}
      {showUpdateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              {isGenerating ? 'Generating...' : 'Save Letter'}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {isGenerating
                ? 'Please wait while your PDF is being generated.'
                : 'This letter was loaded from history. How would you like to save?'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => executeGeneration(true)}
                disabled={isGenerating}
                className="btn btn-primary w-full disabled:opacity-50"
              >
                {isGenerating ? 'Generating...' : 'Update Existing'}
              </button>
              <button
                onClick={() => executeGeneration(false)}
                disabled={isGenerating}
                className="btn w-full bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Create New Copy
              </button>
              <button
                onClick={() => setShowUpdateDialog(false)}
                disabled={isGenerating}
                className="btn btn-secondary w-full disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historical Letter Badge */}
      {selectedLetter && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
            Viewing letter from {formatDate(selectedLetter.created_at)}
          </span>
          <button onClick={clearForm} className="btn btn-primary text-xs py-1 px-3">
            New Letter
          </button>
        </div>
      )}

      {/* Template + Recipient Row */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Template Selector */}
          <div>
            <label className="label">Quick Draft Template</label>
            <select
              value={templateType}
              onChange={(e) => applyTemplate(e.target.value)}
              className="input w-full"
            >
              {templateOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Line Spacing */}
          <div>
            <label className="label">Line Spacing</label>
            <select
              value={lineSpacing}
              onChange={(e) => setLineSpacing(e.target.value)}
              className="input w-full"
            >
              <option value="single">Single</option>
              <option value="1.5">1.5</option>
              <option value="double">Double</option>
            </select>
          </div>
        </div>
      </div>

      {/* AI Draft Panel */}
      <div className="card">
        <button
          type="button"
          onClick={() => setShowAIDrafter(!showAIDrafter)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <span className="font-medium text-gray-900">Draft with AI</span>
            <span className="text-xs text-gray-400 hidden sm:inline">Describe the letter and AI will draft it</span>
          </div>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${showAIDrafter ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAIDrafter && (
          <div className="mt-4 space-y-3">
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder='Describe the letter you need, e.g., "Write a warning letter for late attendance" or "Draft an experience certificate for Rajesh who joined 3 years ago as a Math teacher"'
              rows={3}
              maxLength={500}
              className="input w-full resize-y text-sm"
              disabled={isAIDrafting}
            />

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-1.5">
              {[
                'Experience certificate',
                'Warning for late attendance',
                'Appreciation for excellent work',
                'Salary increment notification',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setAiPrompt(suggestion)}
                  className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full text-xs hover:bg-purple-100 transition-colors"
                  disabled={isAIDrafting}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Context indicators */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {templateType !== 'custom' && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-400 rounded-full" />
                  Template: {templates[templateType]?.name}
                </span>
              )}
              {selectedEmployeeId && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-blue-400 rounded-full" />
                  Employee context included
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAIDraft}
                disabled={isAIDrafting || !aiPrompt.trim()}
                className="btn bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 text-sm"
              >
                {isAIDrafting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating...
                  </>
                ) : 'Generate Draft'}
              </button>
              <button
                onClick={() => { setShowAIDrafter(false); setAiPrompt('') }}
                className="btn btn-secondary text-sm"
                disabled={isAIDrafting}
              >
                Cancel
              </button>
            </div>

            <p className="text-xs text-gray-400">
              AI-generated content will fill the subject and body fields below. You can edit everything before generating the PDF.
            </p>
          </div>
        )}
      </div>

      {/* To + Subject Fields */}
      <div className="card space-y-4">
        {/* To */}
        <div>
          <label className="label">To</label>
          <textarea
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Enter recipient (e.g., Mr. Babar, The Principal...)"
            rows={3}
            maxLength={500}
            className="input w-full resize-y"
          />
          {/* Recipient Type Buttons */}
          <div className="flex gap-2 mt-2 flex-wrap">
            {['school', 'employee', 'custom'].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  if (type === 'custom') {
                    setRecipientMode('custom')
                    setShowPicker(false)
                    setRecipient('')
                  } else {
                    setRecipientMode(type)
                    setShowPicker(true)
                  }
                }}
                className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${
                  recipientMode === type
                    ? type === 'school' ? 'bg-green-100 border-green-400 text-green-700'
                      : type === 'employee' ? 'bg-blue-100 border-blue-400 text-blue-700'
                      : 'bg-purple-100 border-purple-400 text-purple-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>

          {/* Picker Dropdown */}
          {showPicker && (
            <div className="mt-2 bg-white border border-gray-200 rounded-lg max-h-48 overflow-y-auto shadow-sm">
              {recipientMode === 'school' && (
                loadingSchools ? (
                  <p className="p-3 text-sm text-gray-500 text-center">Loading schools...</p>
                ) : schools.length === 0 ? (
                  <p className="p-3 text-sm text-gray-500 text-center">No schools found</p>
                ) : (
                  schools.map(s => (
                    <div
                      key={s.id}
                      onClick={() => {
                        const addr = s.address || ''
                        selectRecipient('school', `The Principal,\n${s.name}${addr ? `\n${addr}` : ''}`)
                      }}
                      className="px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <div className="text-sm font-medium text-gray-900">{s.name}</div>
                      {s.address && <div className="text-xs text-gray-500">{s.address}</div>}
                    </div>
                  ))
                )
              )}
              {recipientMode === 'employee' && (
                loadingStaff ? (
                  <p className="p-3 text-sm text-gray-500 text-center">Loading employees...</p>
                ) : employees.length === 0 ? (
                  <p className="p-3 text-sm text-gray-500 text-center">No employees found</p>
                ) : (
                  employees.map(emp => {
                    const name = emp.full_name ||
                      [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.username
                    return (
                      <div
                        key={emp.id}
                        onClick={() => {
                          const display = emp.employee_id
                            ? `${name}\nEmployee ID: ${emp.employee_id}`
                            : name
                          selectRecipient('employee', display, emp.id)
                          // Prefill body if it has placeholders
                          if (bodyText.includes('{')) {
                            letterComposerApi.prefillTemplate({
                              template_body: bodyText,
                              employee_id: emp.id,
                            }).then(res => {
                              if (res.data.auto_filled) {
                                setBodyText(res.data.prefilled_body)
                                showSuccess('Template prefilled with employee data')
                              }
                            }).catch(() => {})
                            // Also prefill subject
                            if (subject.includes('{')) {
                              letterComposerApi.prefillTemplate({
                                template_body: subject,
                                employee_id: emp.id,
                              }).then(res => {
                                if (res.data.auto_filled) setSubject(res.data.prefilled_body)
                              }).catch(() => {})
                            }
                          }
                        }}
                        className="px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="text-sm font-medium text-gray-900">{name}</div>
                        {emp.employee_id && (
                          <div className="text-xs text-gray-500">ID: {emp.employee_id}</div>
                        )}
                      </div>
                    )
                  })
                )
              )}
            </div>
          )}
        </div>

        {/* Subject */}
        <div>
          <label className="label">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter letter subject"
            maxLength={200}
            className="input w-full"
          />
        </div>
      </div>

      {/* Editor + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Editor */}
        <div className="card">
          <label className="label mb-2">
            Body Text
            <span className="text-xs font-normal text-gray-400 ml-2">
              *bold* _italic_ ~strike~ - bullets 1. numbering
            </span>
          </label>

          {/* Toolbar */}
          <div className="flex flex-wrap gap-1 mb-2">
            {[
              { id: 'bold', label: <strong>B</strong>, title: 'Bold' },
              { id: 'italic', label: <em>I</em>, title: 'Italic' },
              { id: 'strike', label: <s>S</s>, title: 'Strikethrough' },
              { id: 'mono', label: <code>M</code>, title: 'Monospace' },
              { id: 'bullet', label: '\u2022', title: 'Bullet List' },
              { id: 'number', label: '1.', title: 'Numbered List' },
            ].map(btn => (
              <button
                key={btn.id}
                type="button"
                onClick={() => formatText(btn.id)}
                title={btn.title}
                className="px-2.5 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-100 transition-colors min-w-[36px] text-center"
              >
                {btn.label}
              </button>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Enter letter content..."
            rows={14}
            className="input w-full resize-y font-mono text-sm"
          />
        </div>

        {/* Preview */}
        <div className="card">
          <h3 className="label mb-2">Preview</h3>
          <div
            className="prose prose-sm max-w-none min-h-[300px] p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: parseToHTML(bodyText) }}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="btn btn-primary disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Generating...
            </>
          ) : 'Generate PDF'}
        </button>
        <button onClick={clearForm} className="btn btn-secondary">
          Clear Form
        </button>
      </div>

      {/* ============================================ */}
      {/* LETTER HISTORY */}
      {/* ============================================ */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Letter History</h2>
          {loadingLetters && (
            <span className="text-xs text-gray-400">Loading...</span>
          )}
        </div>

        {letters.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">
            No letters yet. Generate a letter to see it here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {letters.map(letter => (
                  <tr key={letter.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-[200px] truncate">
                      {letter.subject}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[150px] truncate">
                      {letter.recipient}
                    </td>
                    <td className="px-4 py-3 text-sm hidden md:table-cell">
                      <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                        {letter.template_display}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatDate(letter.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-1">
                        <button
                          onClick={() => loadLetter(letter.id)}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleDelete(letter.id)}
                          className={`px-2 py-1 text-xs text-white rounded ${
                            deleteConfirmId === letter.id
                              ? 'bg-red-700'
                              : 'bg-red-500 hover:bg-red-600'
                          }`}
                        >
                          {deleteConfirmId === letter.id ? 'Confirm?' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
