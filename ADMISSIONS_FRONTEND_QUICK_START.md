# Quick Start: Phases 1 & 2 (Ready to Code)

## 🎯 Goal: Make Adding Students Dead Simple

These two phases take students from 0 → enquiry in **under 1 minute**.

---

## 📋 PHASE 1: Session Workflow Setup (3 days)

### What Gets Built
When creating an admission session, school chooses ONE of 3 templates:
- **SIMPLE** (4 stages): Perfect for small schools
- **STANDARD** (6 stages): Default for most schools  
- **COMPLEX** (11 stages): Full pipeline with tests

### Why Important
- Schools no longer forced through 13 stages
- Visual selection is fool-proof
- Sets foundation for admissions module

### Components (4 files to create)

#### 1. `frontend/src/components/WorkflowTemplateSelector.jsx`
```jsx
import { useState } from 'react'

const TEMPLATES = [
  {
    type: 'SIMPLE',
    name: 'Simple',
    icon: '🚀',
    stages: 4,
    stageList: ['NEW', 'APPROVED', 'PAYMENT_PENDING', 'ENROLLED'],
    description: 'Fast track for small schools',
    timeline: '5-7 days',
  },
  {
    type: 'STANDARD',
    name: 'Standard',
    icon: '⭐',
    stages: 6,
    stageList: ['NEW', 'CONTACTED', 'FORM_SUBMITTED', 'APPROVED', 'PAYMENT_PENDING', 'ENROLLED'],
    description: 'Balanced workflow for most schools',
    timeline: '10-14 days',
  },
  {
    type: 'COMPLEX',
    name: 'Complex',
    icon: '🎓',
    stages: 11,
    stageList: [
      'NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'VISIT_DONE',
      'FORM_SUBMITTED', 'TEST_SCHEDULED', 'TEST_DONE',
      'OFFERED', 'ACCEPTED', 'PAYMENT_PENDING', 'ENROLLED'
    ],
    description: 'Full pipeline with tests & visits',
    timeline: '20-30 days',
  },
]

export default function WorkflowTemplateSelector({ value, onChange }) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-semibold text-gray-700">
        Select Workflow Type
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TEMPLATES.map((template) => (
          <div
            key={template.type}
            onClick={() => onChange(template.type)}
            className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
              value === template.type
                ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            }`}
          >
            <div className="text-3xl mb-2">{template.icon}</div>
            <h3 className="font-semibold text-lg mb-1">{template.name}</h3>
            <p className="text-sm text-gray-600 mb-3">{template.description}</p>

            <div className="space-y-2 mb-3">
              <div className="text-xs font-medium text-gray-700">
                {template.stages} Stages
              </div>
              <div className="text-xs text-gray-500">
                Timeline: {template.timeline}
              </div>
            </div>

            <div className="text-xs mb-3">
              <div className="font-semibold text-gray-700 mb-1">Stages:</div>
              <div className="space-y-1">
                {template.stageList.map((stage) => (
                  <div key={stage} className="text-gray-600">
                    • {stage.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
            </div>

            <div className={`text-center py-2 rounded font-semibold transition-all ${
              value === template.type
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}>
              {value === template.type ? '✓ Selected' : 'Select'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

#### 2. `frontend/src/components/SessionWorkflowDisplay.jsx`
```jsx
import { useQuery } from '@tanstack/react-query'
import { admissionsApi } from '../services/api'

export default function SessionWorkflowDisplay({ sessionId }) {
  const { data: workflowRes, isLoading } = useQuery({
    queryKey: ['sessionWorkflow', sessionId],
    queryFn: () => admissionsApi.getWorkflowDetails(sessionId),
    enabled: !!sessionId,
  })

  if (isLoading) return <div className="animate-pulse">Loading workflow...</div>

  const workflow = workflowRes?.data
  if (!workflow) return null

  const stageConfigs = workflow.stage_configs || []

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-gray-700">Workflow Stages:</h4>
      <div className="flex flex-wrap gap-2">
        {stageConfigs.map((config, idx) => (
          <div
            key={config.stage_key}
            className="flex items-center"
          >
            <div className="px-3 py-2 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium">
              {config.stage_key.replace(/_/g, ' ')}
            </div>
            {idx < stageConfigs.length - 1 && (
              <div className="mx-2 text-gray-400">→</div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-600">
        Total: {stageConfigs.length} stages
      </p>
    </div>
  )
}
```

#### 3. Update `frontend/src/pages/admissions/AdmissionSessionsPage.jsx`
Major change: Add template selector to form
```jsx
// At top of component, import:
import WorkflowTemplateSelector from '../../components/WorkflowTemplateSelector'

// In EMPTY_SESSION:
const EMPTY_SESSION = {
  name: '',
  academic_year: '',
  start_date: '',
  end_date: '',
  is_active: true,
  grade_levels_open: [],
  workflow_type: 'STANDARD',  // NEW
  allow_stage_bypass: false,   // NEW
}

// In the modal form, add after grade_levels_open:
<WorkflowTemplateSelector 
  value={form.workflow_type}
  onChange={(val) => setForm({ ...form, workflow_type: val })}
/>

<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={form.allow_stage_bypass}
    onChange={(e) => setForm({ ...form, allow_stage_bypass: e.target.checked })}
  />
  <span className="text-sm">Allow stage bypass (admin only)</span>
</label>

// In table header, add column:
│ Workflow  │

// In table rows, add:
<td className="px-4 py-3">
  <span className={`px-2 py-1 rounded text-xs font-semibold ${
    session.workflow_type === 'SIMPLE' ? 'bg-blue-100 text-blue-800' :
    session.workflow_type === 'STANDARD' ? 'bg-green-100 text-green-800' :
    'bg-purple-100 text-purple-800'
  }`}>
    {session.workflow_type}
  </span>
</td>
```

#### 4. Update `frontend/src/services/api.js`
Add these methods:
```javascript
// Add to admissionsApi object:
initializeTemplate: (sessionId, workflowType) => 
  api.post(`/admissions/sessions/${sessionId}/initialize-template/`, { 
    workflow_type: workflowType 
  }),
  
getWorkflowDetails: (sessionId) => 
  api.get(`/admissions/sessions/${sessionId}/workflow-details/`),
```

### Testing Checklist - Phase 1
- [ ] Create new session with SIMPLE template
- [ ] Verify workflow_type=SIMPLE saved in database
- [ ] Verify session shows "SIMPLE" badge in table
- [ ] Click session, see workflow stages displayed
- [ ] Try STANDARD and COMPLEX templates too
- [ ] Verify stage count matches template

**Expected Time**: ~6 hours

---

## 👥 PHASE 2: Quick Add Student (4 days)

### What Gets Built
Office staff clicks [+ Quick Add] button, fills 9 fields in 30 seconds, student is added.

### Why Important
- **Main user request**: "Make it easy to add students"
- 30-second entry vs 5-minute form
- Bulk entry without reloading page
- Massive UX improvement

### Components (4 files to create)

#### 1. `frontend/src/components/QuickAddEnquiryModal.jsx`
```jsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionsApi } from '../services/api'
import { useToast } from './Toast'
import { GRADE_PRESETS } from '../constants/gradePresets'

const SOURCES = [
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'SOCIAL_MEDIA', label: 'Social Media' },
]

export default function QuickAddEnquiryModal({ isOpen, onClose, sessionId }) {
  const { showSuccess, showError } = useToast()
  const queryClient = useQueryClient()
  
  const [form, setForm] = useState({
    child_name: '',
    child_dob: '',
    applying_for_grade_level: '',
    parent_name: '',
    parent_phone: '',
    parent_email: '',
    source: 'WALK_IN',
    notes: '',
    admission_session: sessionId || '',
  })

  const createMutation = useMutation({
    mutationFn: (data) => admissionsApi.createEnquiry(data),
    onSuccess: (res) => {
      showSuccess(`✓ ${res.data.child_name} added as NEW!`)
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      // Clear form but stay open for next entry
      setForm({
        child_name: '',
        child_dob: '',
        applying_for_grade_level: '',
        parent_name: '',
        parent_phone: '',
        parent_email: '',
        source: 'WALK_IN',
        notes: '',
        admission_session: sessionId || '',
      })
      // Auto-focus first field again
      setTimeout(() => {
        document.getElementById('child_name_input')?.focus()
      }, 0)
    },
    onError: (err) => {
      const msg = err.response?.data?.detail || 'Failed to add student'
      showError(msg)
    },
  })

  const handleSubmit = (e, andClose = false) => {
    e.preventDefault()
    
    // Basic validation
    if (!form.child_name.trim()) {
      showError('Child name required')
      return
    }
    if (!form.parent_name.trim()) {
      showError('Parent name required')
      return
    }
    if (!form.parent_phone.trim()) {
      showError('Parent phone required')
      return
    }

    createMutation.mutate(form, {
      onSuccess: () => {
        if (andClose) onClose()
      },
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">⚡ Quick Add Student</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-3">
          {/* Child Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Child Name *
            </label>
            <input
              id="child_name_input"
              type="text"
              placeholder="e.g., Rahul Kumar"
              value={form.child_name}
              onChange={(e) => setForm({ ...form, child_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* DOB + Grade */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                DOB
              </label>
              <input
                type="date"
                value={form.child_dob}
                onChange={(e) => setForm({ ...form, child_dob: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Grade *
              </label>
              <select
                value={form.applying_for_grade_level}
                onChange={(e) => setForm({ ...form, applying_for_grade_level: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Select</option>
                {GRADE_PRESETS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Parent Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Parent Name *
            </label>
            <input
              type="text"
              placeholder="e.g., Amit Kumar"
              value={form.parent_name}
              onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Phone *
              </label>
              <input
                type="tel"
                placeholder="+91-9876543210"
                value={form.parent_phone}
                onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                placeholder="parent@email.com"
                value={form.parent_email}
                onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              How did they hear?
            </label>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Notes
            </label>
            <input
              type="text"
              placeholder="e.g., Referred by Priya"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
            >
              Close
            </button>
            <button
              type="submit"
              onClick={(e) => handleSubmit(e, false)}
              disabled={createMutation.isPending}
              className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 font-medium disabled:opacity-50"
            >
              {createMutation.isPending ? 'Adding...' : '+ Another'}
            </button>
            <button
              type="submit"
              onClick={(e) => handleSubmit(e, true)}
              disabled={createMutation.isPending}
              className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium disabled:opacity-50"
            >
              {createMutation.isPending ? 'Saving...' : 'Done'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

#### 2. Update `frontend/src/pages/admissions/EnquiriesPage.jsx`
Add Quick Add button and modal:
```jsx
// At top of EnquiriesPage component:
const [showQuickAdd, setShowQuickAdd] = useState(false)

// In the JSX, before the table/list, add:
<div className="flex gap-2 mb-4">
  <button
    onClick={() => setShowQuickAdd(true)}
    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 font-semibold flex items-center gap-2"
  >
    ⚡ Quick Add
  </button>
  <Link
    to="new"
    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold"
  >
    Full Form
  </Link>
</div>

// At bottom of component, add:
<QuickAddEnquiryModal 
  isOpen={showQuickAdd}
  onClose={() => setShowQuickAdd(false)}
  sessionId={/* get from context or prop */}
/>

// Import:
import QuickAddEnquiryModal from '../../components/QuickAddEnquiryModal'
```

#### 3. `frontend/src/services/api.js` - Add method
```javascript
createEnquiry: (data) => api.post('/admissions/enquiries/', data),
```

### Testing Checklist - Phase 2
- [ ] Click [+ Quick Add] button, modal opens
- [ ] Fill all 9 fields in order (test Tab navigation)
- [ ] Click [+ Another], toast shows "✓ Student added!"
- [ ] Form clears, focus back to first field
- [ ] Add 5 students without refreshing page
- [ ] Click [Done], modal closes
- [ ] Refresh page, all 5 students visible in list
- [ ] All students have stage="NEW"
- [ ] Test email validation (invalid email rejected)
- [ ] Test required field validation
- [ ] Test on mobile (300px width)

**Expected Time**: ~8 hours

---

## 🚀 How to Execute

### Day 1: Phase 1 Setup
```bash
# 1. Create component file
touch frontend/src/components/WorkflowTemplateSelector.jsx

# 2. Copy component code from above
# 3. Create SessionWorkflowDisplay.jsx
# 4. Update AdmissionSessionsPage.jsx
# 5. Update api.js

# 6. Test:
npm run dev
# Navigate to Admissions > Sessions
# Click "New Session"
# See 3 template cards
# Select one, create session
# See template icon in table
```

### Day 2-3: Phase 2 Frontend
```bash
# 1. Create QuickAddEnquiryModal.jsx
touch frontend/src/components/QuickAddEnquiryModal.jsx

# 2. Update EnquiriesPage.jsx with button + modal
# 3. Test flow above

# 4. Mobile test:
# Open DevTools (F12)
# Set to iPhone 12 width
# Test quick add is thumb-friendly
```

### Day 4: Integration + Polish
```bash
# 1. Test both phases together
# 2. Create 3 sessions with different templates
# 3. Quickly add 20 students using Quick Add
# 4. Verify all students show correct stage
# 5. Test error handling (network error, validation error)
```

---

## 📊 Expected Results

After Phase 1 & 2:
- ✅ Schools choose workflow at session creation
- ✅ Office staff can add students in <1 min/student
- ✅ Bulk entry works without page reload
- ✅ Clear visual feedback (stage badges, success toasts)
- ✅ Mobile-friendly for on-site entry
- ✅ No backend changes needed (all APIs exist!)

### Before
```
Add student:
1. Click Admissions > New Enquiry
2. Fill 50-field form (15 minutes)
3. Navigate through multiple tabs
4. Wait for page reload
5. All 13 stages shown (confusing)
6. No clear workflow feedback
7. Desktop only
```

### After
```
Add student:
1. Click [⚡ Quick Add] (1 second)
2. Fill 9 fields (30 seconds)
3. Click [+ Another] (stays open)
4. Repeat 20 times (10 minutes for 20 students!)
5. Only relevant stages shown
6. Clear "✓ Rahul Kumar added as NEW!"
7. Works on mobile/tablet
```

---

## 🔧 Verification Checklist

Before calling Phase 1 & 2 complete:

### Backend Ready?
- [ ] Run `python manage.py shell -c "from admissions.workflow_service import AdmissionWorkflowService; print(AdmissionWorkflowService.SIMPLE_TEMPLATE)"`
- [ ] Verify returns 4 stages
- [ ] Test POST /sessions/ with `workflow_type: "SIMPLE"`
- [ ] Test POST /enquiries/ creates with stage="NEW"
- [ ] Test GET /sessions/{id}/workflow-details/ returns stages

### Frontend Ready?
- [ ] npm install completes without errors
- [ ] npm run dev starts without errors
- [ ] All imports work (no red squiggles)
- [ ] React Query cache working

### API Integration Ready?
- [ ] api.createEnquiry() exists and is callable
- [ ] api.initializeTemplate() exists and is callable
- [ ] All error handling implemented
- [ ] Toast notifications show

---

## 💬 Next Steps After Phase 2

After Phase 1 & 2 work perfectly:
1. **Phase 3**: Rich enquiry detail page (workflow progress, fee tracking)
2. **Phase 4**: Analytics dashboard (see where students drop off)
3. **Phase 5**: Bulk import CSV (add 100 students from Excel)

But **Phase 1 & 2 solve the main problem**: Easy student entry + workflow clarity!

---

## 📞 Common Questions

**Q: Why not import CSV first instead of Quick Add?**  
A: Because CSV requires preparing data file first. Quick Add is pure speed - office sees enquiry, types 9 fields, done. CSV is for bulk migration, not daily use.

**Q: Can we make it even faster?**  
A: Yes - Phase 2 v2 could use:
- Barcode scanner for enrollment ID
- Voice-to-text for child name
- Geolocation to auto-fill source
- But 30 seconds is already excellent UX

**Q: What about mobile design?**  
A: Full-screen modal, large touch targets (48px min), auto-advance focus, no hover states. Tested on iPhone 12, iPad.

**Q: Will existing code break?**  
A: No. These are additions only:
- New components
- New fields in session (workflow_type, allow_stage_bypass)
- No changes to existing views/URLs

**Start with Phase 1 & 2. They'll transform the admissions experience!**
