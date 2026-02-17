# Admissions Frontend Implementation Plan

## 🎯 Objective
Create an intuitive, professional frontend that makes it **dead simple to add students** while providing powerful workflow management, fee tracking, and analytics. Target: Easy enough for office staff with 0 technical knowledge.

---

## 📊 Current State vs. Future State

### Current Frontend Gaps
- ✗ No workflow template selection during session creation
- ✗ No staged fee payment tracking UI
- ✗ No stage bypass UI (bypass feature exists in backend but not exposed)
- ✗ No analytics/insights dashboard
- ✗ Enquiry form doesn't adapt to selected workflow (still shows all stages)
- ✗ No quick "Add Student" flow for fast entry
- ✗ Limited visual feedback on workflow progress
- ✗ No fee payment status indicators

### What New Backend Provides
- ✓ Template workflows (SIMPLE/STANDARD/COMPLEX)
- ✓ Stage bypass with audit trails
- ✓ Fee payment tracking (AdmissionFeeRecord)
- ✓ Analytics endpoints (funnel, conversion, fees, sources)
- ✓ Configurable stages per session
- ✓ StudentEnrollment auto-creation

---

## 🏗️ Architecture Overview

### Frontend Stack
- **Framework**: React 18 + React Router 7
- **State Management**: TanStack React Query (existing)
- **UI Framework**: Tailwind CSS (existing)
- **Charts**: Recharts (existing)
- **Forms**: React Hook Form (if needed, for complex forms)

### API Integration Points
```
Sessions Management
├─ GET  /sessions/                    (list with pagination)
├─ POST  /sessions/                   (create new session)
├─ GET  /sessions/{id}/               (details)
├─ PATCH /sessions/{id}/              (update)
├─ POST  /sessions/{id}/initialize-template/  (set workflow)
└─ POST  /sessions/{id}/workflow-details/     (get workflow info)

Enquiries Management
├─ POST  /enquiries/                  (quick add - fast entry)
├─ GET  /enquiries/                   (list with filters by workflow type)
├─ GET  /enquiries/{id}/              (detail view)
├─ PATCH /enquiries/{id}/             (edit)
├─ PATCH /enquiries/{id}/update-stage/ (move through workflow + bypass)
├─ POST  /enquiries/{id}/record-fee/  (log payments)
├─ GET  /enquiries/{id}/next-stages/  (UI: show valid next stages)
├─ GET  /enquiries/{id}/workflow-info/ (full workflow state)
└─ POST  /enquiries/{id}/convert/     (enroll student)

Analytics
├─ GET /analytics/overall/            (school-wide)
└─ GET /analytics/session/{session_id}/ (session-specific)
```

---

## 📋 Implementation Phases

### **PHASE 1: Session Workflow Setup UI** (3 days)
Enable schools to choose workflow template when creating admission sessions.

#### Components to Create/Modify

**1. WorkflowTemplateSelector Component**
- Path: `frontend/src/components/WorkflowTemplateSelector.jsx`
- Features:
  - 3 visual cards: SIMPLE | STANDARD | COMPLEX
  - Each card shows:
    - Number of stages
    - Stage names
    - Typical duration
    - Best for (school size/type)
  - Select adds `workflow_type` to session form
  - Drag to preview workflow stages

**Example Card Layout:**
```
┌─────────────────────────┐
│ 🚀 SIMPLE               │
│ Perfect for small       │
│ schools                 │
├─────────────────────────┤
│ 4 Stages               │
│ • Enquiry received     │
│ • Approved             │
│ • Payment pending      │
│ • Enrolled             │
├─────────────────────────┤
│ Timeline: 5-7 days     │
└─────────────────────────┘
```

**2. Update AdmissionSessionsPage.jsx**
- Add workflow template selector to modal form
- Show selected workflow in table (`workflow_type` badge)
- Add initialize-template API call on create
- New fields:
  ```jsx
  {
    workflow_type: 'SIMPLE' | 'STANDARD' | 'COMPLEX',
    allow_stage_bypass: false,  // toggle for power users
  }
  ```

**3. SessionWorkflowDisplay Component**
- Path: `frontend/src/components/SessionWorkflowDisplay.jsx`
- Show current workflow as horizontal timeline/stages list
- Display enabled stages only (not hardcoded)
- Fetch via `/sessions/{id}/workflow-details/`

#### Files to Create
- `frontend/src/components/WorkflowTemplateSelector.jsx`
- `frontend/src/components/SessionWorkflowDisplay.jsx`

#### Files to Modify
- `frontend/src/pages/admissions/AdmissionSessionsPage.jsx` (add selector, call initialize-template)
- `frontend/src/services/api.js` (add initializeTemplate method)

#### UI Mockup - Sessions Page
```
┌─────────────────────────────────────────────────────────┐
│ Admission Sessions     [+ New Session]                  │
├─────────────────────────────────────────────────────────┤
│ Name    │ Year  │ Workflow  │ Open Grades │ Status      │
├─────────────────────────────────────────────────────────┤
│ Spring  │ 2025  │ ⭐ SIMPLE │ 1-5         │ Active ✓    │
│ 2025    │       │ 4 stages  │             │ (3 students)│
├─────────────────────────────────────────────────────────┤
│ Fall    │ 2024  │ COMPLEX   │ All         │ Completed ✓ │
│ 2024    │       │ 11 stages │             │ (145 students)
└─────────────────────────────────────────────────────────┘

[Click "New Session" opens modal]

Modal: Create Admission Session
┌──────────────────────────────────┐
│ Session Name: [____________]     │
│ Academic Year: [Dropdown]        │
│                                  │
│ Select Workflow Type:            │
│ ┌─────────┐ ┌─────────┐ ┌──────┐│
│ │ SIMPLE  │ │STANDARD │ │CMPLX ││
│ │4 stages │ │6 stages │ │11st. ││
│ └─────────┘ └─────────┘ └──────┘│
│                                  │
│ □ Allow stage bypass             │
│                                  │
│ [Cancel] [Create]                │
└──────────────────────────────────┘
```

---

### **PHASE 2: Quick Add Student (Fast Entry)** (4 days)
Make adding new enquiries as fast as possible - 30 seconds per student.

#### Components to Create

**1. QuickAddEnquiryModal Component**
- Path: `frontend/src/components/QuickAddEnquiryModal.jsx`
- Ultra-minimal form:
  ```
  Session: [Auto-selected current session]
  
  Child Name: [_________________]
  Date of Birth: [___/___/____]
  Grade Applying: [Dropdown]
  
  Parent Name: [_________________]
  Parent Phone: [_________________]
  Parent Email: [_________________]
  
  Source: [Dropdown - Walk-in/Phone/Website...]
  Notes: [________________]
  
  [Close] [Save & Add Another] [Save & View]
  ```
- Flow:
  1. Click "Quick Add" button
  2. Fill 9 fields (takes ~30 seconds)
  3. Click "Save & Add Another" for bulk entry
  4. Gets created as NEW stage automatically
  5. Toast: "✓ Student added! Current stage: NEW"
- Features:
  - Tab-through friendly (Tab moves to next field)
  - Auto-focus first field
  - "Save & Add Another" clears form
  - Phone number formatting
  - Email validation client-side

**2. Enquiry List Quick Actions Toolbar**
- Path: Update `frontend/src/pages/admissions/EnquiriesPage.jsx`
- Top toolbar with:
  - [Quick Add +] button (opens modal)
  - [Import CSV] button (for bulk upload - PHASE 4)
  - [Export] button (for backup)
- Updated after Quick Add without full page refresh

**3. MinimalEnquiryForm Component**
- Path: `frontend/src/components/MinimalEnquiryForm.jsx`
- Used in QuickAddModal
- Only required fields
- Styled for speed (low mental overhead)

#### API Integration
```javascript
// POST /enquiries/
{
  admission_session: sessionId,
  child_name: "Rahul Kumar",
  child_dob: "2015-03-15",
  applying_for_grade_level: 3,
  parent_name: "Amit Kumar",
  parent_phone: "+91-9876543210",
  parent_email: "amit@example.com",
  source: "WALK_IN",
  notes: "Referred by Priya"
}
// Response: { id, current_stage, status, ... }
```

#### Files to Create
- `frontend/src/components/QuickAddEnquiryModal.jsx`
- `frontend/src/components/MinimalEnquiryForm.jsx`

#### Files to Modify
- `frontend/src/pages/admissions/EnquiriesPage.jsx` (add Quick Add button)
- `frontend/src/services/api.js` (add createEnquiryQuick method)

#### UI Mockup - Enquiries List with Quick Add
```
┌────────────────────────────────────────────────────┐
│ [+ Quick Add] [📥 Import] [📤 Export]              │
│ Enquiries for Spring 2025 Session                 │
├────────────────────────────────────────────────────┤
│ Student    │ Parent    │ Grade │ Stage  │ Actions │
├────────────────────────────────────────────────────┤
│ Rahul K.   │ Amit K.   │ 3     │ NEW    │ ⋯       │
│ Priya S.   │ Raj S.    │ 5     │ FORM   │ ⋯       │
│ Maya P.    │ Uma P.    │ 2     │ NEW    │ ⋯       │
└────────────────────────────────────────────────────┘

[Click "Quick Add"]
┌─────────────────────────────┐
│ ⚡ Quick Add Student        │
├─────────────────────────────┤
│ Child Name: [_________]     │
│ DOB: [_____] Grade: [▼]     │
│ Parent: [_________]         │
│ Phone: [_________]          │
│ Email: [_________]          │
│ Source: [▼ Walk-in]         │
│ Notes: [_________]          │
│                             │
│ [Close] [+ Another] [Save]  │
└─────────────────────────────┘
```

---

### **PHASE 3: Enhanced Enquiry Detail & Workflow UI** (4 days)
Rich management view showing full workflow state, payments, and next actions.

#### Components to Create

**1. WorkflowProgressBar Component**
- Path: `frontend/src/components/WorkflowProgressBar.jsx`
- Features:
  - Horizontal stage timeline
  - Current stage highlighted
  - Completed stages ✓ marked
  - Click to jump (if bypass enabled)
  - Shows estimated timeline
  - Example:
  ```
  NEW ✓ → APPROVED → CONTACTED (current) → FORM_SUBMITTED → ENROLLED
  [25% complete] [Est. 8 more days]
  ```

**2. StageTransitionPanel Component**
- Path: `frontend/src/components/StageTransitionPanel.jsx`
- Features:
  - Shows current stage (big, centered)
  - "Next Stage" button (primary CTA)
  - Shows valid next stages from `/next-stages/` endpoint
  - If bypass enabled: "Skip Stage" option with preview
  - Confirmation dialog before transition
  - Shows required pre-conditions (e.g., "Fee must be paid")
  - Loading state during API call
  - Success/error toast

**3. FeePaymentWidget Component**
- Path: `frontend/src/components/FeePaymentWidget.jsx`
- Features:
  - Shows required fee amount (from session config)
  - Shows paid amount
  - Shows pending amount (bright red if needed before next stage)
  - [+ Record Payment] button opens modal
  - Shows payment history (dates, amounts, notes)
  - Integration: PATCH `/enquiries/{id}/record-fee/`
  - Blocks transition if `require_fee_before_enrollment` and not paid

**4. WorkflowStageNotes Component**
- Path: `frontend/src/components/WorkflowStageNotes.jsx`
- Features:
  - Timeline of stage changes
  - Notes on who did what when
  - Red banner if stage was bypassed
  - Audit trail (bypass reason, who authorized, timestamp)

#### Update EnquiryDetail.jsx
- Remove old hardcoded stage list
- Replace with WorkflowProgressBar + StageTransitionPanel
- Fetch workflow from `/enquiries/{id}/workflow-info/`
- Add FeePaymentWidget
- Add WorkflowStageNotes timeline
- Add bypass toggle + reason field (if allowed)

#### Files to Create
- `frontend/src/components/WorkflowProgressBar.jsx`
- `frontend/src/components/StageTransitionPanel.jsx`
- `frontend/src/components/FeePaymentWidget.jsx`
- `frontend/src/components/WorkflowStageNotes.jsx`
- `frontend/src/hooks/useWorkflowTransition.js` (logic hook for transitions)

#### Files to Modify
- `frontend/src/pages/admissions/EnquiryDetail.jsx` (complete redesign)
- `frontend/src/services/api.js` (add updateStage, recordFee, getWorkflowInfo)

#### UI Mockup - Enquiry Detail
```
┌─────────────────────────────────────────────────────┐
│ Enquiry #2841 - Rahul Kumar | Created: Jan 15, 2025 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Workflow Progress:                                  │
│ NEW ✓ → APPROVED ✓ → CONTACTED (●) → OFFERED       │
│ [50% complete] [Est. 5 more days]                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ CURRENT STAGE: CONTACTED                            │
│ Started: 2 days ago | 📝 3 notes                    │
│                                                     │
│ What's Next?                                        │
│ ┌──────────────────────────────────┐               │
│ │ Next Stage: VISIT_SCHEDULED      │               │
│ │ Requirement: Schedule campus tour│               │
│ │ Est. Time: 3-5 days              │               │
│ │ [Next Stage »]                   │               │
│ └──────────────────────────────────┘               │
│                                                     │
├─────────────────────────────────────────────────────┤
│ 💰 Fee Status:                                      │
│ Required: $5,000 | Paid: $0 | Pending: $5,000      │
│ ⚠️  Must pay before enrollment                     │
│ [+ Record Payment]                                 │
│                                                     │
├─────────────────────────────────────────────────────┤
│ 📋 Timeline:                                        │
│ ✓ Jan 15 - NEW (Received via Walk-in)              │
│ ✓ Jan 16 - APPROVED (by Principal)                 │
│ ● Jan 18 - CONTACTED (Called parent)               │
│   └─ "Parent interested, needs time"               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### **PHASE 4: Analytics Dashboard** (3 days)
Provide insights into workflow health, conversion rates, and revenue.

#### Components to Create

**1. AdminAnalyticsDashboard Component**
- Path: `frontend/src/pages/admissions/AdmissionAnalyticsDashboard.jsx`
- Full dashboard for admissions team lead/principal
- Sections:
  - KPI Cards (top row)
  - Workflow comparison chart
  - Funnel visualization
  - Fee collection status
  - Bypass usage insights
  - Source performance (marketing ROI)
  - Trend line (monthly conversions)

**2. KPICards Component**
- Path: `frontend/src/components/KPICards.jsx`
- 6 cards:
  ```
  Total Enquiries: 145
  
  Conversion Rate: 34%
  
  Avg. Days to Enroll: 12
  
  Fee Collection: 89%
  
  Active Stage: CONTACTED (45 students)
  
  Monthly Growth: +18%
  ```

**3. FunnelChart Component**
- Path: `frontend/src/components/FunnelChart.jsx`
- Recharts-based funnel showing drop-off per stage
- Tooltip shows actual numbers and %
- Example:
  ```
  Enquiries: 100 (100%)
  ↓
  Approved: 85 (85%)
  ↓
  Form Submitted: 72 (72%)
  ↓
  Enrolled: 34 (34%)
  ```

**4. WorkflowTypeMetrics Component**
- Path: `frontend/src/components/WorkflowTypeMetrics.jsx`
- Bar chart comparing SIMPLE vs STANDARD vs COMPLEX
- Metrics: enrollment rate, avg days, fee collection %

**5. FeeAnalyticsWidget Component**
- Path: `frontend/src/components/FeeAnalyticsWidget.jsx`
- Donut chart: Paid vs Pending vs Overdue
- Total amounts

**6. SourcePerformanceTable Component**
- Path: `frontend/src/components/SourcePerformanceTable.jsx`
- Table: Source | Enquiries | Conversions | Conversion Rate
- Helps identify best marketing channel

#### API Integration
```javascript
// GET /analytics/overall/
{
  total_enquiries: 145,
  enrolled_count: 34,
  conversion_rate: 0.234,
  avg_days_to_enroll: 12,
  fee_collection_rate: 0.89,
  current_stage_breakdown: { NEW: 20, CONTACTED: 45, ... },
  workflow_type_stats: { SIMPLE: { ... }, STANDARD: { ... }, ... },
  source_performance: [ { source: 'WALK_IN', count: 50, enrolled: 15 }, ... ],
  monthly_trends: [ { month: 'Jan', enquiries: 45, enrolled: 10 }, ... ],
  fee_analytics: { total_required: 500000, total_paid: 445000, ... },
}

// GET /analytics/session/{session_id}/
// Same structure but for one session
```

#### Files to Create
- `frontend/src/pages/admissions/AdmissionAnalyticsDashboard.jsx`
- `frontend/src/components/KPICards.jsx`
- `frontend/src/components/FunnelChart.jsx`
- `frontend/src/components/WorkflowTypeMetrics.jsx`
- `frontend/src/components/FeeAnalyticsWidget.jsx`
- `frontend/src/components/SourcePerformanceTable.jsx`
- `frontend/src/hooks/useAdmissionsAnalytics.js`

#### Files to Modify
- `frontend/src/pages/admissions/AdmissionDashboard.jsx` (add analytics link)
- `frontend/src/App.jsx` (add route to analytics dashboard)
- `frontend/src/services/api.js` (add analytics methods)

#### UI Mockup - Analytics Dashboard
```
┌──────────────────────────────────────────────────────┐
│ Admissions Analytics - Spring 2025               [📊] │
├──────────────────────────────────────────────────────┤
│                                                      │
│ [Total: 145]  [Conv: 34%]  [Avg: 12d]  [Fee: 89%]  │
│ [Active: 45]  [Growth: 18%]                         │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│ ┌──────────────────────┐  ┌──────────────────────┐  │
│ │ Funnel               │  │ Workflow Comparison  │  │
│ │ Enquiries: 100%      │  │ SIMPLE:   34 (85%)  │  │
│ │ Approved: 85%        │  │ STANDARD: 89 (72%)  │  │
│ │ Form: 72%            │  │ COMPLEX:  22 (41%)  │  │
│ │ Enrolled: 34%        │  │                      │  │
│ └──────────────────────┘  └──────────────────────┘  │
│                                                      │
│ ┌──────────────────────┐  ┌──────────────────────┐  │
│ │ Fee Collection       │  │ Top Sources          │  │
│ │ Paid: 89%            │  │ Walk-in:   50 (28%)  │  │
│ │ Pending: 11%         │  │ Referral:  35 (19%)  │  │
│ │ Over 15d: 2%         │  │ Website:   30 (16%)  │  │
│ └──────────────────────┘  └──────────────────────┘  │
│                                                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Monthly Trend                                    │ │
│ │ [Graph showing Jan-Jun trend]                   │ │
│ └─────────────────────────────────────────────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### **PHASE 5: Bulk Import & Export** (2 days)
Enable CSV upload for multiple students and data exports.

#### Components to Create

**1. CSVImportModal Component**
- Path: `frontend/src/components/CSVImportModal.jsx`
- Features:
  - Drag-drop CSV upload
  - Template download (shows expected columns)
  - Preview uploaded data (first 5 rows)
  - Column mapping UI (auto-detect, manual override)
  - Validation:
    - Required fields check
    - Phone format validation
    - Email format validation
  - Batch create API call
  - Progress bar (X of Y imported)
  - Error report (rows that failed + reasons)

**2. ExportDataModal Component**
- Path: `frontend/src/components/ExportDataModal.jsx`
- Export options:
  - All enquiries
  - Filtered by stage
  - Filtered by date range
  - Format: CSV or Excel
  - Includes: all fields, includes notes, includes fees

#### CSV Templates

**Import Template:**
```csv
child_name,child_dob,applying_for_grade_level,parent_name,parent_phone,parent_email,source,notes
Rahul Kumar,2015-03-15,3,Amit Kumar,+91-9876543210,amit@example.com,WALK_IN,Referred by Priya
Priya Sharma,2013-05-20,5,Raj Sharma,+91-9876543211,raj@example.com,PHONE,Called from website
```

#### Files to Create
- `frontend/src/components/CSVImportModal.jsx`
- `frontend/src/components/ExportDataModal.jsx`
- `frontend/src/utils/csvImportParser.js` (parse + validate CSV)
- `frontend/src/utils/csvExportGenerator.js` (generate CSV)

#### Files to Modify
- `frontend/src/pages/admissions/EnquiriesPage.jsx` (add Import/Export buttons)
- `frontend/src/services/api.js` (add bulkCreateEnquiries)

---

### **PHASE 6: Mobile-Friendly Optimization** (2 days)
Ensure smooth experience on tablets/phones for on-site entry.

#### Key Changes
1. **EnquiryForm**: Full-screen mobile view, large touch targets
2. **QuickAddModal**: Reorder fields for mobile thumb zones
3. **WorkflowProgressBar**: Vertical timeline on mobile
4. **FeePaymentWidget**: Larger input fields, bigger buttons
5. **Analytics**: Single-column layout on mobile

#### Implementation
- Use existing Tailwind responsive classes
- Test on iPhone 12, iPad, Samsung Galaxy
- Focus on QuickAdd being 100% thumb-operable

---

### **PHASE 7: Role-Based Features & Approvals** (2 days)
Add admin workflow for critical actions (bypass, bulk approve, etc).

#### Features
1. **Bypass Approval Flow** (if Principal approval needed)
   - Staff clicks "Skip Stage"
   - Modal shows reason field
   - Sends to principal for approval
   - Principal gets in-app notification
   - Approval/rejection modal
   - Audit trail logged

2. **Bulk Actions**
   - Select multiple enquiries
   - Bulk move to next stage
   - Bulk record fee (partial payment)
   - Bulk assign to staff

3. **Permissions**
   - Admin can initialize template & enable bypass
   - Staff can manage enquiries (add, move stages)
   - Principal can approve bypasses & view analytics
   - Receptionist can only do Quick Add

#### Files to Modify
- Role-based views in all components
- API error handling (403 Forbidden for unauthorized)

---

## 🎨 Design System

### Color Scheme (Using existing Tailwind palette)
```javascript
// Stage colors
NEW: 'bg-blue-100 text-blue-800'
APPROVED: 'bg-green-100 text-green-800'
CONTACTED: 'bg-indigo-100 text-indigo-800'
PAYMENT_PENDING: 'bg-amber-100 text-amber-800'
ENROLLED: 'bg-teal-100 text-teal-800'
REJECTED: 'bg-red-100 text-red-800'

// Priority colors
HIGH: 'bg-red-100 text-red-700'
MEDIUM: 'bg-amber-100 text-amber-700'
LOW: 'bg-green-100 text-green-700'

// Fee status
PAID: 'text-green-600'
PENDING: 'text-amber-600'
OVERDUE: 'text-red-600'
```

### Typography
- **Headers**: Tailwind `text-2xl font-bold` (existing)
- **Labels**: `text-sm font-semibold text-gray-700`
- **Values**: `text-lg font-medium`
- **Hints**: `text-xs text-gray-500`

### Spacing
- Use Tailwind defaults: `p-4`, `gap-4`, `mb-6`
- Cards: `p-6` with `rounded-lg shadow`

### Icons
- Use emoji for now (✓, ✗, ⚡, 💰, 📋, 📊, 📤, 📥)
- Can upgrade to Lucide React icons later

---

## 📱 API Service Integration

### Update `frontend/src/services/api.js`

```javascript
export const admissionsApi = {
  // Sessions
  getSessions: (params) => api.get('/admissions/sessions/', { params }),
  createSession: (data) => api.post('/admissions/sessions/', data),
  getSession: (id) => api.get(`/admissions/sessions/${id}/`),
  updateSession: (id, data) => api.patch(`/admissions/sessions/${id}/`, data),
  initializeTemplate: (id, workflow_type) => 
    api.post(`/admissions/sessions/${id}/initialize-template/`, { workflow_type }),
  getWorkflowDetails: (id) => 
    api.get(`/admissions/sessions/${id}/workflow-details/`),

  // Enquiries
  getEnquiries: (params) => api.get('/admissions/enquiries/', { params }),
  createEnquiry: (data) => api.post('/admissions/enquiries/', data),
  createEnquiryQuick: (data) => api.post('/admissions/enquiries/', data),
  bulkCreateEnquiries: (data) => 
    api.post('/admissions/enquiries/bulk/', data),
  getEnquiry: (id) => api.get(`/admissions/enquiries/${id}/`),
  updateEnquiry: (id, data) => api.patch(`/admissions/enquiries/${id}/`, data),
  updateStage: (id, data) => 
    api.patch(`/admissions/enquiries/${id}/update-stage/`, data),
  getNextStages: (id) => 
    api.get(`/admissions/enquiries/${id}/next-stages/`),
  getWorkflowInfo: (id) => 
    api.get(`/admissions/enquiries/${id}/workflow-info/`),
  recordFee: (id, data) => 
    api.post(`/admissions/enquiries/${id}/record-fee/`, data),
  convertToStudent: (id, data) => 
    api.post(`/admissions/enquiries/${id}/convert/`, data),

  // Analytics
  getOverallAnalytics: () => 
    api.get('/admissions/analytics/overall/'),
  getSessionAnalytics: (sessionId) => 
    api.get(`/admissions/analytics/session/${sessionId}/`),
}
```

---

## 🚀 Implementation Order (Recommended)

### Week 1 (Priority)
1. **PHASE 1**: Session Workflow Setup UI (make template selection visual)
2. **PHASE 2**: Quick Add Student (the main request - make adding easy!)

### Week 2
3. **PHASE 3**: Enhanced Enquiry Detail & Workflow UI (rich state display)

### Week 3
4. **PHASE 4**: Analytics Dashboard (insights + decision making)

### Week 4
5. **PHASE 5**: Bulk Import/Export (if needed by users)
6. **PHASE 6**: Mobile Optimization
7. **PHASE 7**: Role-Based Features (can be optional)

---

## 📋 Progress Checklist

### PHASE 1: Session Workflow Setup
- [ ] Create WorkflowTemplateSelector component
- [ ] Create SessionWorkflowDisplay component
- [ ] Update AdmissionSessionsPage with selector + initialize call
- [ ] Style cards with workflow info
- [ ] Test workflow_type persists in session

### PHASE 2: Quick Add Student
- [ ] Create QuickAddEnquiryModal component
- [ ] Create MinimalEnquiryForm component
- [ ] Update EnquiriesPage with quick add button
- [ ] Add createEnquiryQuick to API service
- [ ] Test bulk entry flow
- [ ] Keyboard shortcuts (Tab navigation)
- [ ] "Save & Add Another" button works

### PHASE 3: Enhanced Enquiry Detail
- [ ] Create WorkflowProgressBar component
- [ ] Create StageTransitionPanel component
- [ ] Create FeePaymentWidget component
- [ ] Create WorkflowStageNotes component
- [ ] Create useWorkflowTransition hook
- [ ] Redesign EnquiryDetail.jsx
- [ ] Test stage transitions with bypass
- [ ] Test fee blocking enrollment
- [ ] Test invalid transitions blocked

### PHASE 4: Analytics Dashboard
- [ ] Create AdmissionAnalyticsDashboard page
- [ ] Create KPICards component
- [ ] Create FunnelChart with Recharts
- [ ] Create WorkflowTypeMetrics component
- [ ] Create FeeAnalyticsWidget component
- [ ] Create SourcePerformanceTable component
- [ ] Create useAdmissionsAnalytics hook
- [ ] Add route to analytics page
- [ ] Test all charts render properly
- [ ] Test data updates on enquiry changes

### PHASE 5: Bulk Import/Export
- [ ] Create CSVImportModal component
- [ ] Create ExportDataModal component
- [ ] Create csvImportParser utility
- [ ] Create csvExportGenerator utility
- [ ] Add import/export buttons to EnquiriesPage
- [ ] Test CSV parsing validation
- [ ] Test batch creation endpoint
- [ ] Test export data integrity

### PHASE 6: Mobile Optimization
- [ ] Make QuickAdd full-screen on mobile
- [ ] Test form on iPhone
- [ ] Test form on iPad
- [ ] Make workflow progress mobile-friendly
- [ ] Test analytics on mobile

### PHASE 7: Role-Based Features
- [ ] Add bypass approval flow
- [ ] Add bulk action checkboxes
- [ ] Add permission checks to views
- [ ] Test with different roles

---

## 🔗 Backend Dependencies

**Ensure Backend Has:**
- ✓ `initialize-template/` endpoint on sessions
- ✓ `update-stage/` endpoint with bypass support
- ✓ `record-fee/` endpoint
- ✓ `next-stages/` endpoint
- ✓ `workflow-info/` endpoint
- ✓ `/analytics/overall/` endpoint
- ✓ `/analytics/session/{id}/` endpoint
- ✓ All serializers return necessary fields

**Verify Before Frontend:**
```bash
curl http://localhost:8000/api/admissions/sessions/{id}/workflow-details/
curl http://localhost:8000/api/admissions/enquiries/{id}/workflow-info/
curl http://localhost:8000/api/admissions/enquiries/{id}/next-stages/
curl http://localhost:8000/api/admissions/analytics/overall/
```

---

## 💡 Tips for Success

### For Making Student Entry Ultra-Easy:
1. **QuickAdd takes 30 seconds max** - Don't ask everything upfront
2. **Tab-through friendly** - No need to reach for mouse
3. **Smart defaults** - Current session auto-selected
4. **Confirmation tone** - Tell user what stage they entered (NEW)
5. **Bulk entry supported** - "Save & Add Another"

### For UX Excellence:
1. **Progressive disclosure** - Show all workflow details in detail view, not list
2. **Color coding** - Each stage has a consistent color
3. **Visual feedback** - Buttons show loading state during API call
4. **Error clarity** - Don't just say "Error", explain what went wrong
5. **Success celebration** - Toast when student added: "✓ Rahul Kumar added!"

### For Performance:
1. **Query caching** - Use React Query stale times
2. **Pagination** - Don't load all 1000 enquiries at once
3. **Debounce search** - 300ms wait before API call
4. **Lazy load analytics** - Only fetch when dashboard opens

---

## 🎯 Success Metrics

After implementation, these should be true:
- ✅ New student can be added in <1 minute (Quick Add)
- ✅ School can choose workflow at session creation
- ✅ Staff can see workflow progress visually
- ✅ Fees are tracked and payment blocking works
- ✅ Admin can see analytics (funnel, sources, revenue)
- ✅ Mobile works for on-site enquiry entry
- ✅ System handles 1000+ enquiries smoothly

---

## 📞 Questions to Answer Before Coding

1. **Should bypass need approval?** (Or auto-allowed if permission granted?)
2. **Email confirmations?** (Auto-email parent when stage changes?)
3. **SMS notifications?** (Text parent about next steps?)
4. **Custom fields?** (Some schools need extra fields beyond standard?)
5. **Student photo?** (Capture during Quick Add or later?)
6. **API limits?** (Max page size? Max bulk upload count?)
7. **Data retention?** (How long keep "REJECTED" enquiries?)

---

## 📚 Related Documentation
- Backend: See `ADMISSIONS_SIMPLIFICATION_PLAN.md`
- Bypass Guide: See `ADMISSIONS_BYPASS_GUIDE.md`
- Analytics: See `ADMISSIONS_ANALYTICS_GUIDE.md`

---

**Total Estimated Effort**: 150-180 development hours (6-8 weeks with 1 dev, 2-3 weeks with 3 devs)
