# Apply TOC API Endpoint Blocking Investigation - Summary Report

**Date:** 2026-05-10  
**Issue:** Backend `POST /api/lms/books/{id}/apply_toc/` endpoint is never called when user clicks "Apply to Book" button, despite success toast appearing

---

## Executive Summary

The frontend flow **APPEARS** correct through code inspection, but the backend endpoint is never being called. This suggests either:

1. **The mutation is silently failing** before making the HTTP request
2. **The success toast is coming from a different callback** (e.g., cache invalidation instead of API response)
3. **There's a race condition or state issue** preventing `mutate()` from executing

---

## Code Flow Analysis: ✅ VERIFIED

### Button Click → handleApplyToc: ✅ Correct
- **File:** [CurriculumPage.jsx](CurriculumPage.jsx#L3399)
- **Line:** 3399
- **Code:** `if (tocImageWizardStep === 6) { handleApplyToc() }`
- **Status:** Routes correctly when step is 6/6

### handleApplyToc Function: ✅ Correct Setup
- **File:** [CurriculumPage.jsx](CurriculumPage.jsx#L1015-L1067)
- **Checks:**
  - ✅ Validates `selectedBookId` exists (line 1017)
  - ✅ Validates chapters have titles (line 1054)
  - ✅ Builds proper payload with idempotency_key (line 1061-1064)
  - ✅ Calls `applyTocMutation.mutate()` with correct params (line 1067)
- **Debugging:** Has 4x console.log statements for tracing (lines 1021, 1053, 1065-1066)

### Mutation Definition: ✅ Correct Setup
- **File:** [CurriculumPage.jsx](CurriculumPage.jsx#L673-L683)
- **Checks:**
  - ✅ `mutationFn` correctly destructures `{ id, data }`
  - ✅ Calls `lmsApi.applyTOC(id, data)` correctly
  - ✅ `onSuccess` callback invalidates cache and closes modal
  - ✅ `onError` callback shows error toast
- **Issue Detection:** No obvious setup problems

### API Client: ✅ Correct Implementation
- **File:** [api.js](api.js#L956)
- **Endpoint:** `applyTOC: (id, data) => api.post(/api/lms/books/${id}/apply_toc/, data)`
- **Status:** Properly configured

### Request Interceptors: ✅ No Blockages
- **File:** [api.js](api.js#L26-L42)
- **Added Headers:**
  - ✅ Authorization Bearer token
  - ✅ X-School-ID header
- **No middleware appears to block requests**

---

## Root Cause Analysis: 🔴 To Be Determined

### Hypothesis 1: handleApplyToc Never Executes
**Symptoms:**
- Console logs at lines 1021, 1053, 1065-1066 don't appear
- "Apply to Book" button appears clickable

**Investigation:**
```
1. Add click tracking to button:
   console.log('Button clicked, tocImageWizardStep:', tocImageWizardStep)
   
2. Verify step is actually 6:
   console.log('Is step 6?', tocImageWizardStep === 6)
   
3. If step never reaches 6, trace the modal state management
```

### Hypothesis 2: mutate() Silently Fails
**Symptoms:**
- Console logs appear in handleApplyToc
- No network request in DevTools
- Success toast still appears

**Investigation:**
```
1. Check if applyTocMutation is in error state:
   console.log('applyToc.isError:', applyTocMutation.isError)
   console.log('applyToc.error:', applyTocMutation.error)
   
2. Check if mutation is stuck in pending state:
   console.log('applyToc.isPending:', applyTocMutation.isPending)
   
3. Add error handler to mutate():
   applyTocMutation.mutate(
     { id: selectedBookId, data: payload },
     {
       onSuccess: () => console.log('[SUCCESS]'),
       onError: (err) => console.log('[ERROR]', err),
     }
   )
```

### Hypothesis 3: Success Toast from Different Source
**Symptoms:**
- Success toast "Table of contents imported" appears
- But this doesn't come from `onSuccess` callback
- Instead comes from cache invalidation side effect

**Investigation:**
```
1. Add breakpoint in onSuccess callback
2. Check if it's actually being called
3. Search for other showSuccess('Table of contents imported') calls
4. Verify closeTocModal() is called (modal should close)
```

---

## Diagnostic Tools Provided

### Tool 1: ApplyTocDiagnostics Component
**File:** [ApplyTocDiagnostics.jsx](ApplyTocDiagnostics.jsx)

**Use case:** Isolated mutation testing without CurriculumPage complexity

**How to use:**
```javascript
// In CurriculumPage render:
import ApplyTocDiagnostics from './ApplyTocDiagnostics'

// Add to JSX:
<ApplyTocDiagnostics />

// Test with a real book ID
```

**Output:** Real-time execution log showing every step of mutation lifecycle

### Tool 2: Instrumentation Code Snippets
**File:** [APPLY_TOC_INSTRUMENTATION.js](APPLY_TOC_INSTRUMENTATION.js)

**Includes:**
- Function call tracing wrapper
- Mutation callback tracking
- Network request logging
- Real-time state debug component

**How to use:**
- Copy code snippets
- Paste into CurriculumPage.jsx
- Replace button onClick handler
- Run app and click button
- Check console for [TRACE] logs

### Tool 3: Complete Debug Guide
**File:** [APPLY_TOC_DEBUG_GUIDE.md](APPLY_TOC_DEBUG_GUIDE.md)

**Contains:**
- Step-by-step investigation workflow
- Console monitoring checklist
- Network tab monitoring checklist
- Backend verification checklist
- Minimal reproducible test code

---

## Investigation Checklist

### ✅ Step 1: Verify Console Logs Appear
```javascript
// Click "Apply to Book" button and check browser console for:
[handleApplyToc] Current tocChapters state: ...
[handleApplyToc] After processing: ... chapters with titles
[handleApplyToc] Applying TOC with ... chapters to book ...
[handleApplyToc] Full payload: ...
```

**If YES → Continue to Step 2**  
**If NO → handleApplyToc is not being called (check button step condition)**

### ✅ Step 2: Verify Network Request
```javascript
// Open DevTools Network tab
// Click "Apply to Book" button
// Look for: POST /api/lms/books/{id}/apply_toc/
```

**If YES → Continue to Step 3**  
**If NO → applyTocMutation.mutate() is not executing (check mutation state)**

### ✅ Step 3: Check Backend Logs
```bash
# Terminal where Django is running:
tail -f django_output.log | grep -i "apply"

# Or look for:
# - HTTP 200 POST response
# - No entry means request never reached backend
```

**If YES → Backend received request, check if handler executed**  
**If NO → Request sent but middleware ate it or URL mismatch**

### ✅ Step 4: Verify Toast Source
```javascript
// Add temporary log in onSuccess callback:
onSuccess: () => {
  console.log('[ONsuccess-CALLBACK] Fired!') // Add this
  queryClient.invalidateQueries(...)
  closeTocModal()
  showSuccess('Table of contents imported')
}

// If this log doesn't appear but toast does → toast is from elsewhere
```

---

## Next Action Items

### For User

1. **Immediate:** Use **ApplyTocDiagnostics.jsx** to get real-time mutation execution trace
   - Time required: 5 minutes
   - Provides: Clear picture of what's executing and what's not

2. **Then:** Follow the **Debug Guide** step-by-step
   - Section: "Diagnostic Workflow" has 4 steps
   - Each step takes 2-3 minutes

3. **Report findings with:**
   - Screenshot of diagnostic component output
   - Console logs (paste browser console)
   - Network tab screenshot
   - Backend Django logs
   - Backend URL routing file

### Likely Fix Once Root Cause is Identified

- **If handleApplyToc not called:** Fix button onClick routing condition
- **If mutation blocked:** Check for React Query v5 initialization issues or Suspense boundaries
- **If URL mismatch:** Fix endpoint path in lmsApi or backend urls.py
- **If backend doesn't log:** Add logging to view or check URL pattern registration

---

## Code Locations Reference

| Component | File | Line(s) | Issue |
|-----------|------|---------|-------|
| Button | [CurriculumPage.jsx](CurriculumPage.jsx#L3399) | 3399 | Routes to handleApplyToc ✅ |
| Handler | [CurriculumPage.jsx](CurriculumPage.jsx#L1015) | 1015-1067 | Calls mutation ✅ |
| Mutation | [CurriculumPage.jsx](CurriculumPage.jsx#L673) | 673-683 | Setup looks correct ✅ |
| API Client | [api.js](api.js#L956) | 956 | Endpoint definition ✅ |
| Request Interceptor | [api.js](api.js#L27) | 27-42 | No obvious blockage ✅ |
| Modal Closure | [CurriculumPage.jsx](CurriculumPage.jsx#L868) | 868-908 | Resets state correctly ✅ |

---

## Key Questions for Debugging

1. **Does browser console show `[handleApplyToc]` logs?**
   - YES → The function is being called, issue is in mutation
   - NO → The function is never called, check button click routing

2. **Does DevTools Network tab show POST to `/apply_toc/`?**
   - YES → Request is being sent, check backend
   - NO → Mutation not executing, check React Query state

3. **Does backend Django log show the request?**
   - YES → Handler is being called, check if it completes successfully
   - NO → Request never reached backend, check interceptors/middleware

4. **Does `closeTocModal()` get called (modal closes)?**
   - YES → onSuccess fired, issue might be data persistence
   - NO → onSuccess never fired, request failed silently

---

## Expected Working Behavior

```
User clicks "Apply to Book" button
   ↓
Button onClick: if (step === 6) handleApplyToc()
   ↓
handleApplyToc():
  - Validate selectedBookId ✅
  - Log: [handleApplyToc] Current tocChapters state
  - Build chapters payload ✅
  - Log: [handleApplyToc] Applying TOC with X chapters
  - Call: applyTocMutation.mutate({ id, data }) ✅
   ↓
Mutation sets isPending = true ✅
   ↓
Network Request: POST /api/lms/books/{id}/apply_toc/
   ↓
Django Backend:
  - Logs request
  - Validates payload
  - Saves TOC to database
  - Returns 200 OK response
   ↓
onSuccess callback:
  - queryClient.invalidateQueries() ✅
  - closeTocModal() ✅
  - showSuccess('Table of contents imported') ✅
   ↓
Modal closes, toast appears, data persisted ✅
```

---

## File Summary

| File | Purpose | Status |
|------|---------|--------|
| [APPLY_TOC_DEBUG_GUIDE.md](APPLY_TOC_DEBUG_GUIDE.md) | Complete investigation guide | 📖 Reference |
| [ApplyTocDiagnostics.jsx](ApplyTocDiagnostics.jsx) | Isolated mutation tester | 🧪 Use immediately |
| [APPLY_TOC_INSTRUMENTATION.js](APPLY_TOC_INSTRUMENTATION.js) | Code snippets to add to CurriculumPage | 🔧 Reference |
| This file | Investigation summary | 📋 Overview |

---

## Success Criteria

Debugging is complete when:

1. ✅ Browser console clearly shows `[handleApplyToc]` logs
2. ✅ Network tab shows POST request to `/api/lms/books/{id}/apply_toc/`
3. ✅ Backend Django logs show request received
4. ✅ Database shows TOC has been persisted for the book
5. ✅ No errors in browser console or backend logs
6. ✅ Modal closes after successful apply
7. ✅ Success toast appears with correct message

---

## Contact Points for Questions

- **Frontend mutation not executing?** → Check React Query v5 setup, Suspense boundaries
- **Network request appears but backend doesn't see it?** → Check URL routing, middleware, reverse proxy
- **Backend logs but nothing is saved?** → Check database transaction, view logic
- **Toast appears but no data change?** → Check onSuccess callback, cache invalidation
