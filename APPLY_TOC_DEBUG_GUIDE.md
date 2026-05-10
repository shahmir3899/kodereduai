## Apply TOC Mutation Debugging Guide

### FINDING #1: Button Flow Analysis

**Location:** [frontend/src/pages/lms/CurriculumPage.jsx](frontend/src/pages/lms/CurriculumPage.jsx#L3399)

The "Apply to Book" button (Step 5/6 in carousel) clicks correctly at line 3399:
```javascript
if (tocImageWizardStep === 6) { handleApplyToc() }
```

✅ **VERIFIED:** Button routing is correct and calls `handleApplyToc()`

---

### FINDING #2: handleApplyToc Implementation

**Location:** [frontend/src/pages/lms/CurriculumPage.jsx](frontend/src/pages/lms/CurriculumPage.jsx#L1015-L1067)

The function has proper debugging:
- ✅ Line 1021: Logs current `tocChapters` state (JSON)
- ✅ Line 1053: Logs chapter count after processing
- ✅ Line 1065-1066: Logs final payload before mutation call
- ✅ Line 1067: **Calls `applyTocMutation.mutate({ id: selectedBookId, data: payload })`**

**Validation checks:**
- Returns early if no `selectedBookId` ❌ (early return)
- Returns early if `chapters.length === 0` ❌ (early return)
- Builds proper payload with chapters and idempotency_key ✅

---

### FINDING #3: Mutation Setup

**Location:** [frontend/src/pages/lms/CurriculumPage.jsx](frontend/src/pages/lms/CurriculumPage.jsx#L673-L683)

```javascript
const applyTocMutation = useMutation({
  mutationFn: ({ id, data }) => lmsApi.applyTOC(id, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['lmsBookTree', selectedBookId] })
    closeTocModal()
    showSuccess('Table of contents imported')
  },
  onError: (error) => {
    showError(error.response?.data?.detail || ...)
  },
})
```

✅ **VERIFIED:**
- `mutationFn` destructures `{ id, data }` correctly
- Calls `lmsApi.applyTOC(id, data)` with proper params
- `onSuccess` invalidates cache, closes modal, shows toast
- `onError` shows error toast

---

### FINDING #4: API Client Definition

**Location:** [frontend/src/services/api.js](frontend/src/services/api.js#L956)

```javascript
applyTOC: (id, data) => api.post(`/api/lms/books/${id}/apply_toc/`, data),
```

✅ **VERIFIED:** Correctly uses `api.post()` with proper endpoint

---

### FINDING #5: Interceptor Setup

**Location:** [frontend/src/services/api.js](frontend/src/services/api.js#L26-L42)

Request interceptor adds:
- ✅ Authorization token
- ✅ `X-School-ID` header

Response interceptor handles:
- ✅ 401 token refresh retry
- ✅ Redirects to login on refresh failure

✅ **VERIFIED:** No obvious middleware blocking the request

---

### POSSIBLE ROOT CAUSES

#### Issue #1: Console Logs Not Appearing
If `handleApplyToc` console.logs (lines 1021, 1053, 1065-1066) don't appear in browser console:
- 🔴 **PROBLEM:** `handleApplyToc()` is never being called
- **Check:** Is the button click event actually firing? (Add a click listener to the button)
- **Check:** Is `tocImageWizardStep === 6`? (Log the step value)

#### Issue #2: Console Logs Appear But Network Request Missing
If logs appear but DevTools Network tab shows NO POST to `/api/lms/books/.../apply_toc/`:
- 🔴 **PROBLEM:** `applyTocMutation.mutate()` is blocked or React Query isn't invoking it
- **Check:** Is `applyTocMutation.isPending` stuck in `true` state? (from previous failed mutation)
- **Check:** Is there a React Suspense/Error Boundary hiding errors?
- **Check:** Are there any custom middleware or conditional logic in the onClick handler?

#### Issue #3: Network Request Appears But Backend Never Logs It
If Network tab shows POST request but backend has NO log entry:
- 🔴 **PROBLEM:** Request is being intercepted before reaching Django
- **Check:** Is there a reverse proxy or middleware eating the request?
- **Check:** Is the URL path correct? (`/api/lms/books/{id}/apply_toc/` vs `/api/lms/books/{id}/apply-toc/`)
- **Check:** Does the endpoint exist on the backend? (Check URL routing)

#### Issue #4: "Success Toast" Appears But No Action Taken
If you see "Table of contents imported" toast but database unchanged:
- 🔴 **PROBLEM:** `onSuccess` callback fires but backend request never happened
- **Likely:** The success toast is from **cache invalidation** or **unrelated** onSuccess callback
- **Check:** Add a network monitor to confirm the request is sent
- **Check:** Is there a race condition or timeout?

---

### DIAGNOSTIC WORKFLOW

#### Step 1: Check Browser Console
```
1. Open DevTools Console
2. Click "Apply to Book" button
3. Look for these console logs:
   - [handleApplyToc] Current tocChapters state: ...
   - [handleApplyToc] After processing: ... chapters with titles
   - [handleApplyToc] Applying TOC with ... chapters to book ...
   - [handleApplyToc] Full payload: ...
```

**If logs appear → Go to Step 2**  
**If logs DON'T appear → handleApplyToc is not being called**

#### Step 2: Check Network Tab
```
1. Open DevTools Network tab
2. Filter for "apply_toc" or "POST" requests
3. Click "Apply to Book" button
4. Look for: POST /api/lms/books/{id}/apply_toc/
```

**If request appears → Check backend logs (Step 4)**  
**If request doesn't appear → Mutation.mutate() is not executing (Step 3)**

#### Step 3: Check Mutation State
Use the **ApplyTocDiagnostics.jsx** component:
```javascript
// Add to CurriculumPage render temporarily:
import ApplyTocDiagnostics from './ApplyTocDiagnostics'

// In JSX:
<ApplyTocDiagnostics />

// Or test in isolation with a real book ID:
// The component will log every step of the mutation lifecycle
```

**Expected log flow:**
```
[DIAG] TEST_START bookId: 123
[DIAG] PAYLOAD_PREPARED chapters: 2, totalTopics: 3
[DIAG] CALLING_MUTATION {}
[DIAG] MUTATION_FN_START receivedId: 123, payloadSize: 285
[DIAG] MUTATION_FN_API_CHECK isFunction: true
[DIAG] MUTATION_FN_CALLED_API method: POST, endpoint: /api/lms/books/123/apply_toc/, hasPromise: true
[DIAG] PROMISE_RESOLVED status: 200, dataKeys: ['id', 'title', 'chapter_count']
[DIAG] MUTATION_ON_SUCCESS status: 200, hasData: true
[DIAG] MUTATION_CACHE_INVALIDATED result: true
[DIAG] MUTATION_COMPLETE_SUCCESS {}
[DIAG] MUTATION_SETTLED {}
```

#### Step 4: Check Backend Logs
```bash
# In another terminal:
cd backend
python manage.py runserver 8000

# Watch for POST /api/lms/books/ logs
# The endpoint should appear in Django logs when request arrives
```

If you see the Django log but the handler doesn't execute:
- Check if the view method is defined
- Check if the URL pattern is registered correctly
- Add logging inside the view to trace execution

---

### Quick Test: Minimal Reproduction

#### Option A: Use ApplyTocDiagnostics Component (Easiest)
1. Enter a real book ID
2. Click "Run Direct Mutation Test"
3. Watch the execution log
4. Check Network tab simultaneously

#### Option B: Add Inline Console Monitoring
In CurriculumPage.jsx, modify handleApplyToc (line 1015):

```javascript
const handleApplyToc = () => {
  console.log('[handleApplyToc] START')
  console.log('[handleApplyToc] selectedBookId:', selectedBookId)
  console.log('[handleApplyToc] applyTocMutation.isPending:', applyTocMutation.isPending)
  console.log('[handleApplyToc] applyTocMutation.isError:', applyTocMutation.isError)
  
  // ... existing validation ...
  
  const payload = { /* ... */ }
  
  console.log('[handleApplyToc] About to call mutate()')
  console.log('[handleApplyToc] Payload:', payload)
  
  applyTocMutation.mutate({ id: selectedBookId, data: payload })
  
  console.log('[handleApplyToc] mutate() called, isPending should now be true')
  console.log('[handleApplyToc] applyTocMutation.isPending:', applyTocMutation.isPending)
}
```

#### Option C: Monitor Mutation State in Real-time
Add a debug component:

```javascript
{/* Temporary Debug: Show mutation state */}
{showDebug && (
  <div className="fixed bottom-4 right-4 bg-black text-white p-4 rounded text-xs">
    <div>applyToc.isPending: {applyTocMutation.isPending.toString()}</div>
    <div>applyToc.isError: {applyTocMutation.isError.toString()}</div>
    <div>applyToc.isSuccess: {applyTocMutation.isSuccess.toString()}</div>
  </div>
)}
```

---

### Summary: The Most Likely Causes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Console logs don't appear | `handleApplyToc()` never called | Check button onClick routing, check `tocImageWizardStep === 6` condition |
| Console logs appear, no network request | `mutation.mutate()` blocked or fails silently | Check if mutation is in error state, check for Suspense/Error boundaries |
| Network request appears, backend doesn't log it | URL path mismatch or endpoint not registered | Verify endpoint URL pattern in Django urls.py |
| Success toast appears but nothing happens | Toast fires from unrelated callback or cache invalidation | Add breakpoint in `onSuccess` callback to verify it's actually executing |

---

### Backend Verification Checklist

1. **Check URL pattern exists:**
   ```bash
   # backend/lms/urls.py
   path('books/<int:id>/apply_toc/', views.ApplyTOCView.as_view(), name='apply_toc'),
   ```

2. **Check view is defined:**
   ```python
   # backend/lms/views.py
   class ApplyTOCView(APIView):
       def post(self, request, id):
           # Log here
           print(f"[DEBUG] ApplyTOCView.post() called with book_id={id}")
           # ...
   ```

3. **Add request logging:**
   ```python
   import logging
   logger = logging.getLogger(__name__)
   
   class ApplyTOCView(APIView):
       def post(self, request, id):
           logger.info(f"ApplyTOC request received: book_id={id}, data={request.data}")
           # ...
   ```

4. **Tail Django logs:**
   ```bash
   # In separate terminal
   tail -f /path/to/django/logs.log | grep -i "apply"
   ```

---

### Next Steps

1. **Use ApplyTocDiagnostics.jsx** to trace mutation execution (fastest)
2. **Monitor Network tab** during test to see if HTTP request is made
3. **Check backend logs** to see if Django receives the request
4. **Report findings** with:
   - Diagnostic component output
   - Network tab screenshot
   - Browser console output
   - Backend logs
