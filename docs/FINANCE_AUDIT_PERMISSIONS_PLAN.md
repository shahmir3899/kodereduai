# Finance Audit Trail & Edit Permissions - Implementation Plan

**Date:** March 9, 2026  
**Status:** READY FOR IMPLEMENTATION  
**Related:** AUDIT_TRAIL_IMPLEMENTATION_PLAN.md (completed)

---

## Executive Summary

This plan implements two critical features for Finance transaction audit and security:

1. **Edit Permissions:** Only admins or the user who created an entry can edit/delete it
2. **Frontend Audit Display:** Show `recorded_by` and `created_at` (actual timestamp) on all Finance pages

---

## User Requirements

### Requirement 1: Edit Restrictions
**Rule:** Entries once created should only be editable by:
- **Admins** (SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL) → Can edit ANY entry
- **Original Creator** → Can edit ONLY their own entries
- **Others** → Cannot edit entries created by others

**Applies to:** Expense, OtherIncome, Transfer

### Requirement 2: Frontend Audit Visibility
**Rule:** Users must see WHO recorded each transaction and WHEN (actual timestamp)

**Fields to Display:**
- `recorded_by_name` → Username of person who recorded it
- `created_at` → Actual system timestamp (YYYY-MM-DD HH:MM:SS format)

**Applies to:** Expense, OtherIncome, Transfer pages

### Requirement 3: Fee Collection Audit Display
**Rule:** Fee collection page must show WHO collected payment, WHEN, and which ACCOUNT received the money

**Fields to Display:**
- `collected_by_name` → Username of person who collected payment
- `account_name` → Which account received the payment
- `created_at` → Actual system timestamp

**Applies to:** Fee Collection page (`/finance/fees/collect`)

**Note:** FeePayment uses `collected_by` field (equivalent to `recorded_by` in other models)

### Requirement 4: Fee Collection Filtered Statistics
**Rule:** Fee collection page must display summary statistics that update based on applied filters (class, status, fee type)

**Statistics to Display:**
- `Total Students` → Count of students in filtered results
- `Total Payable` → Sum of amount_due for filtered payments
- `Total Paid` → Sum of amount_paid for filtered payments
- `Balance` → Total Payable - Total Paid

**Implementation:**
- Use existing `FeeSummaryCards` component (already used in FeeOverviewPage)
- Compute summary from filtered payments, not all payments
- Show statistics in card grid above the fee table
- Update automatically when filters change (class, status, fee type)

**Applies to:** Fee Collection page (`/finance/fees/collect`)

---

## Current State Analysis

### Backend (✓ Partially Ready)
| Model | Audit Field | API Returns It | perform_create Sets It | perform_update Exists | Edit Check |
|-------|-------------|----------------|------------------------|----------------------|------------|
| Expense | recorded_by | ✓ Yes | ✓ Yes | ✗ No | ✗ No |
| OtherIncome | recorded_by | ✓ Yes | ✓ Yes | ✗ No | ✗ No |
| Transfer | recorded_by | ✓ Yes | ✓ Yes | ✗ No | ✗ No |
| FeePayment | collected_by | ✓ Yes | ✓ Yes (via perform_update) | ✓ Yes | ✗ No |

**Conclusion:** Models and serializers ready, but ViewSets lack edit permission checks.

### Frontend (Partial Implementation)
| Page | Shows audit user | Shows account | Shows created_at | Edit Button Logic |
|------|-----------------|---------------|------------------|-------------------|
| ExpensesPage | ✓ Desktop only | ✗ No | ✗ No | No permission check |
| OtherIncomePage | ✗ No | ✗ No | ✗ No | No permission check |
| TransfersPage | ✗ No | ✗ No | ✗ No | No permission check |
| FeeCollectPage | ✗ No | ✗ No | ✗ No | No permission check |

**Conclusion:** Audit fields partially shown, no permission checks on UI. Fee collection page missing all audit fields.

---

## Implementation Plan

### Phase 1: Backend Permission Enforcement (Priority: HIGH)

#### 1.1 Create Permission Helper Function

**File:** `backend/finance/views.py`

Add this helper at module level (before ViewSets):

```python
def can_edit_finance_entry(user, entry):
    """
    Check if user can edit/delete a finance entry.
    
    Args:
        user: Request user object
        entry: Expense, OtherIncome, or Transfer instance
    
    Returns:
        bool: True if user can edit, False otherwise
    
    Rules:
        - Admins (SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL) can edit anything
        - User who created the entry (recorded_by) can edit own entry
        - Others cannot edit
    """
    from core.permissions import ADMIN_ROLES, get_effective_role
    
    # Admins can edit anything
    role = get_effective_role(request)
    if role in ADMIN_ROLES:
        return True
    
    # User can edit own entries
    if entry.recorded_by_id == user.id:
        return True
    
    return False
```

**Note:** We need to pass `request` to this function, so signature should be:
```python
def can_edit_finance_entry(request, entry):
    """..."""
    from core.permissions import get_effective_role, ADMIN_ROLES
    
    role = get_effective_role(request)
    if role in ADMIN_ROLES:
        return True
    
    if entry.recorded_by_id == request.user.id:
        return True
    
    return False
```

#### 1.2 Add perform_update to ExpenseViewSet

**File:** `backend/finance/views.py` → ExpenseViewSet (around line 905)

```python
def perform_update(self, serializer):
    """
    Check edit permission before allowing update.
    Only admins or the original creator can edit.
    """
    instance = serializer.instance
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only edit expenses you recorded. "
            "Contact an admin to modify this entry."
        )
    serializer.save()
```

#### 1.3 Add perform_destroy to ExpenseViewSet

```python
def perform_destroy(self, instance):
    """
    Check delete permission before allowing deletion.
    Only admins or the original creator can delete.
    """
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only delete expenses you recorded. "
            "Contact an admin to remove this entry."
        )
    instance.delete()
```

#### 1.4 Add perform_update & perform_destroy to OtherIncomeViewSet

**File:** `backend/finance/views.py` → OtherIncomeViewSet (around line 1005)

Same as Expense (copy-paste with "expenses" → "income records"):

```python
def perform_update(self, serializer):
    instance = serializer.instance
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only edit income records you recorded. "
            "Contact an admin to modify this entry."
        )
    serializer.save()

def perform_destroy(self, instance):
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only delete income records you recorded. "
            "Contact an admin to remove this entry."
        )
    instance.delete()
```

#### 1.5 Add perform_update & perform_destroy to TransferViewSet

**File:** `backend/finance/views.py` → TransferViewSet (around line 2020)

Same pattern:

```python
def perform_update(self, serializer):
    instance = serializer.instance
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only edit transfers you recorded. "
            "Contact an admin to modify this entry."
        )
    serializer.save()

def perform_destroy(self, instance):
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only delete transfers you recorded. "
            "Contact an admin to remove this entry."
        )
    instance.delete()
```

---

### Phase 2: Frontend Audit Trail Display (Priority: HIGH)

#### 2.1 Update ExpensesPage.jsx

**File:** `frontend/src/pages/ExpensesPage.jsx`

**Changes:**

1. **Add `created_at` column to desktop table** (around line 143):

```jsx
<thead className="bg-gray-50">
  <tr>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
    {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>}
  </tr>
</thead>
```

2. **Add `created_at` data cell** (around line 156):

```jsx
<td className="px-4 py-3 text-sm text-gray-500">{expense.recorded_by_name || '-'}</td>
<td className="px-4 py-3 text-xs text-gray-400">
  {new Date(expense.created_at).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })}
</td>
```

3. **Add audit info to mobile view** (around line 122):

```jsx
<div key={expense.id} className="border rounded-lg p-3">
  <div className="flex items-center justify-between mb-2">
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(expense.category)}`}>
      {expense.category_name || 'Uncategorized'}
    </span>
    <span className="text-sm text-gray-500">{expense.date}</span>
  </div>
  <p className="text-lg font-bold text-gray-900">{Number(expense.amount).toLocaleString()}</p>
  {expense.description && <p className="text-sm text-gray-600 mt-1">{expense.description}</p>}
  
  {/* NEW: Audit trail info */}
  <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-gray-500">
    <span>By: {expense.recorded_by_name || 'Unknown'}</span>
    <span>{new Date(expense.created_at).toLocaleDateString()}</span>
  </div>
  
  {canWrite && (
    <div className="flex gap-2 mt-2">
      <button onClick={() => openEdit(expense)} className="text-xs text-primary-600 hover:underline">Edit</button>
      <button onClick={handleDelete(expense.id)} className="text-xs text-red-600 hover:underline">Delete</button>
    </div>
  )}
</div>
```

4. **Add permission check to Edit/Delete buttons** (both mobile and desktop):

```jsx
// Helper function at component level
const canEditExpense = (expense) => {
  if (!user) return false
  // Check if user is admin
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user.role)
  if (isAdmin) return true
  // Check if user is creator
  return expense.recorded_by === user.id
}

// In table/card render:
{canWrite && canEditExpense(expense) && (
  <div className="flex gap-2">
    <button onClick={() => openEdit(expense)}>Edit</button>
    <button onClick={handleDelete(expense.id)}>Delete</button>
  </div>
)}
```

**Alternative (Better UX):** Show Edit/Delete always but disable with tooltip:

```jsx
{canWrite && (
  <div className="flex gap-2">
    {canEditExpense(expense) ? (
      <>
        <button onClick={() => openEdit(expense)} className="text-xs text-primary-600">Edit</button>
        <button onClick={handleDelete(expense.id)} className="text-xs text-red-600">Delete</button>
      </>
    ) : (
      <>
        <button disabled className="text-xs text-gray-400 cursor-not-allowed" title="Only creator or admins can edit">Edit</button>
        <button disabled className="text-xs text-gray-400 cursor-not-allowed" title="Only creator or admins can delete">Delete</button>
      </>
    )}
  </div>
)}
```

#### 2.2 Update OtherIncomePage.jsx

**File:** `frontend/src/pages/fee-collection/OtherIncomePage.jsx`

**Changes:**

1. **Add columns to desktop table** (around line 132):

```jsx
<thead className="bg-gray-50">
  <tr>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
    {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>}
  </tr>
</thead>
```

2. **Add data cells:**

```jsx
<td className="px-4 py-3 text-sm text-gray-500">{item.recorded_by_name || '-'}</td>
<td className="px-4 py-3 text-xs text-gray-400">
  {new Date(item.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })}
</td>
```

3. **Add audit info to mobile view** (around line 118):

```jsx
<div key={item.id} className="border rounded-lg p-3">
  <div className="flex items-center justify-between mb-1">
    <span className="text-sm font-medium text-gray-900">{item.category_name}</span>
    <span className="font-bold text-green-700">{Number(item.amount).toLocaleString()}</span>
  </div>
  <p className="text-xs text-gray-500">{item.date} {item.description && `— ${item.description}`}</p>
  {item.account_name && <p className="text-xs text-gray-400 mt-1">Account: {item.account_name}</p>}
  
  {/* NEW: Audit trail */}
  <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-gray-500">
    <span>By: {item.recorded_by_name || 'Unknown'}</span>
    <span>{new Date(item.created_at).toLocaleDateString()}</span>
  </div>
  
  {canWrite && canEditIncome(item) && (
    <button onClick={() => handleDeleteIncome(item.id)} className="mt-2 text-xs text-red-600">Delete</button>
  )}
</div>
```

4. **Add permission check helper:**

```jsx
const canEditIncome = (item) => {
  if (!user) return false
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user.role)
  if (isAdmin) return true
  return item.recorded_by === user.id
}
```

#### 2.3 Update TransfersPage (in ExpensesPage.jsx)

**File:** `frontend/src/pages/ExpensesPage.jsx` (Transfers tab, around line 175)

**Changes:**

1. **Add columns to desktop table:**

```jsx
<thead className="bg-gray-50">
  <tr>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From Account</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To Account</th>
    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
    {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>}
  </tr>
</thead>
```

2. **Add data cells:**

```jsx
<td className="px-4 py-3 text-sm text-gray-500">{tfr.recorded_by_name || '-'}</td>
<td className="px-4 py-3 text-xs text-gray-400">
  {new Date(tfr.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })}
</td>
```

3. **Add audit info to mobile view:**

```jsx
<div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-gray-500">
  <span>By: {tfr.recorded_by_name || 'Unknown'}</span>
  <span>{new Date(tfr.created_at).toLocaleDateString()}</span>
</div>
```

4. **Add permission check to Delete button:**

```jsx
const canEditTransfer = (tfr) => {
  if (!user) return false
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user.role)
  if (isAdmin) return true
  return tfr.recorded_by === user.id
}

// In render:
{canWrite && canEditTransfer(tfr) && (
  <button onClick={handleDeleteTransfer(tfr.id)}>Delete</button>
)}
```

#### 2.4 Update FeeCollectPage / FeeTable.jsx

**File:** `frontend/src/pages/fee-collection/FeeTable.jsx`

**Purpose:** Show who collected payment, which account received it, and when

**Changes:**

1. **Add columns to desktop table** (after Status column, around line 215):

```jsx
<thead className="bg-gray-50">
  <tr>
    {/* ... existing columns ... */}
    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Collected By</th>
    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Collected At</th>
    {canWrite && <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>}
  </tr>
</thead>
```

2. **Add data cells** (after Status cell, around line 307):

```jsx
<td className="px-3 py-3 text-center">{statusBadge(payment.status)}</td>
<td className="px-3 py-3 text-xs text-gray-600">
  {payment.account_name || '-'}
</td>
<td className="px-3 py-3 text-xs text-gray-600">
  {payment.collected_by_name || '-'}
</td>
<td className="px-3 py-3 text-xs text-gray-400">
  {payment.created_at ? new Date(payment.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '-'}
</td>
```

3. **Add audit info to mobile cards** (around line 159):

```jsx
{/* After balance display, before action buttons */}
{(payment.account_name || payment.collected_by_name) && (
  <div className="mt-2 pt-2 border-t">
    {payment.account_name && (
      <p className="text-xs text-gray-600">
        <span className="text-gray-500">Account:</span> {payment.account_name}
      </p>
    )}
    <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
      <span>Collected by: {payment.collected_by_name || 'Unknown'}</span>
      {payment.created_at && (
        <span>{new Date(payment.created_at).toLocaleDateString()}</span>
      )}
    </div>
  </div>
)}
```

4. **Add permission check for Delete button** (already has `canWrite` check, no additional restriction needed for fees):

```jsx
// Fee payments can be deleted by any user with write access (staff excluded)
// This is current behavior - no change needed
```

**Note:** FeePayment deletion does NOT require "creator-only" restriction because:
- It's a transactional record tied to student billing
- Admins and accountants need flexibility to correct mistakes
- The `collected_by` field preserves accountability even if record is deleted (via audit logs)

#### 2.5 Add Filtered Statistics to FeeCollectPage

**Files:** 
- `frontend/src/pages/fee-collection/FeeCollectPage.jsx`
- `frontend/src/pages/fee-collection/useFeeCollection.js`

**Purpose:** Display summary statistics that update based on applied filters (class, status, fee type)

**Current Issue:** 
- `summaryData` is computed from ALL payments (unfiltered)
- Statistics don't reflect what user sees in filtered table
- Missing "Total Students" metric

**Required Statistics:**
- **Total Students** → Count of students in filtered results
- **Total Payable** → Sum of amount_due for filtered payments  
- **Total Paid** → Sum of amount_paid for filtered payments
- **Balance** → Total Payable - Total Paid

**Changes:**

1. **Update `useFeeCollection.js`** to compute filtered summary (around line 95):

```javascript
// BEFORE:
const summaryData = useMemo(
  () => computeSummaryData(allPayments, apiMonth, year),
  [allPayments, apiMonth, year]
)

// AFTER:
const summaryData = useMemo(
  () => computeSummaryData(allPayments, apiMonth, year),
  [allPayments, apiMonth, year]
)

// NEW: Add filtered summary
const filteredSummaryData = useMemo(
  () => {
    if (filteredPayments.length === 0) return null
    const total_due = filteredPayments.reduce((s, p) => s + Number(p.amount_due), 0)
    const total_collected = filteredPayments.reduce((s, p) => s + Number(p.amount_paid), 0)
    return {
      month: apiMonth,
      year,
      total_students: filteredPayments.length,
      total_due,
      total_collected,
      total_pending: Math.max(0, total_due - total_collected),
    }
  },
  [filteredPayments, apiMonth, year]
)

return {
  // Data
  summaryData,         // All payments summary (for overview page)
  filteredSummaryData, // NEW: Filtered summary (for collect page)
  paymentList: filteredPayments,
  // ... rest unchanged
}
```

2. **Update `FeeCollectPage.jsx`** to display statistics (add after filters, around line 160):

```jsx
import FeeSummaryCards from './FeeSummaryCards'

// In component:
const data = useFeeCollection({
  month, year, classFilter, statusFilter, feeTypeFilter,
  academicYearId: activeAcademicYear?.id,
})

// Add after FeeFilters component:
return (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold text-gray-900">Fee Collection</h1>
      {/* ... buttons ... */}
    </div>

    <FeeFilters
      /* ... props ... */
    />

    {/* NEW: Summary Statistics */}
    {data.filteredSummaryData && (
      <FeeSummaryCards summaryData={data.filteredSummaryData} />
    )}

    <BulkActionsBar
      /* ... props ... */
    />

    <FeeTable
      /* ... props ... */
    />
  </div>
)
```

3. **Update `FeeSummaryCards.jsx`** to show "Total Students" (around line 12):

```jsx
export default function FeeSummaryCards({ summaryData }) {
  if (!summaryData) return null

  const collectionRate = summaryData.total_due > 0
    ? Math.round((summaryData.total_collected / summaryData.total_due) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
      {/* NEW: Total Students card (only show if metric exists) */}
      {summaryData.total_students !== undefined && (
        <div className="card">
          <p className="text-sm text-gray-500">Total Students</p>
          <p className="text-xl font-bold text-gray-900">{summaryData.total_students}</p>
        </div>
      )}
      
      <div className="card">
        <p className="text-sm text-gray-500">Total Payable</p>
        <p className="text-xl font-bold text-gray-900">{Number(summaryData.total_due || 0).toLocaleString()}</p>
      </div>
      <div className="card">
        <p className="text-sm text-gray-500">Received</p>
        <p className="text-xl font-bold text-green-700">{Number(summaryData.total_collected || 0).toLocaleString()}</p>
      </div>
      <div className="card">
        <p className="text-sm text-gray-500">Balance</p>
        <p className="text-xl font-bold text-orange-700">{Number(summaryData.total_pending || 0).toLocaleString()}</p>
      </div>
      <div className="card">
        <p className="text-sm text-gray-500">Collection Rate</p>
        <p className="text-xl font-bold text-blue-700">{collectionRate}%</p>
      </div>
    </div>
  )
}
```

**Alternative (Simpler):** Keep 4-card layout, add student count as subtitle:

```jsx
<div className="card">
  <p className="text-sm text-gray-500">Total Payable</p>
  <p className="text-xl font-bold text-gray-900">{Number(summaryData.total_due || 0).toLocaleString()}</p>
  {summaryData.total_students && (
    <p className="text-xs text-gray-400 mt-1">{summaryData.total_students} students</p>
  )}
</div>
```

**Behavior:**
- When no filters applied → Shows stats for ALL students in selected month/year
- When class filter applied → Shows stats for ONLY that class
- When status filter applied → Shows stats for ONLY that status (e.g., only UNPAID)
- When both applied → Shows stats for intersection (e.g., Class A + UNPAID only)

---

### Phase 3: Error Handling & User Feedback (Priority: MEDIUM)

#### 3.1 Update API Service to Handle Permission Errors

**File:** `frontend/src/services/api.js`

Ensure API error interceptor shows clear message for 403 PermissionDenied:

```javascript
// In axios interceptor (if not already):
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      const message = error.response?.data?.detail || 'Permission denied'
      toast.error(message) // Use Toast context
    }
    return Promise.reject(error)
  }
)
```

#### 3.2 Update Mutation Handlers to Show Errors

**In ExpensesPage.jsx, OtherIncomePage.jsx:**

```jsx
const updateMutation = useMutation({
  mutationFn: ({ id, data }) => financeApi.updateExpense(id, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
    closeModal()
    toast.success('Expense updated successfully')
  },
  onError: (error) => {
    const message = error.response?.data?.detail || 'Failed to update expense'
    toast.error(message)
  }
})

const deleteMutation = useMutation({
  mutationFn: (id) => financeApi.deleteExpense(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
    toast.success('Expense deleted successfully')
  },
  onError: (error) => {
    const message = error.response?.data?.detail || 'Failed to delete expense'
    toast.error(message)
  }
})
```

---

### Phase 4: Testing (Priority: HIGH)

#### 4.1 Backend Permission Tests

**File:** `backend/test_finance_edit_permissions.py` (CREATE NEW)

```python
"""
Test edit permission enforcement for Finance transactions.
"""

import pytest
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from decimal import Decimal
from datetime import date

from finance.models import Expense, OtherIncome, Transfer, Account, ExpenseCategory, IncomeCategory
from schools.models import School, Membership

User = get_user_model()


class FinanceEditPermissionTests(TestCase):
    """Test that only admins or creators can edit finance entries."""

    def setUp(self):
        self.school = School.objects.create(name='Test School', code='TS001')
        
        # Create users with different roles
        self.admin_user = User.objects.create_user(username='admin', password='pass', role='SCHOOL_ADMIN')
        self.creator_user = User.objects.create_user(username='creator', password='pass', role='ACCOUNTANT')
        self.other_user = User.objects.create_user(username='other', password='pass', role='ACCOUNTANT')
        
        # Create memberships
        for user in [self.admin_user, self.creator_user, self.other_user]:
            Membership.objects.create(user=user, school=self.school, role=user.role)
        
        self.account = Account.objects.create(
            school=self.school,
            name='Test Account',
            account_type='CASH'
        )
        self.category = ExpenseCategory.objects.create(
            school=self.school,
            name='Test Category'
        )
        
        # Create expense by creator_user
        self.expense = Expense.objects.create(
            school=self.school,
            amount=Decimal('1000.00'),
            date=date(2026, 3, 9),
            account=self.account,
            category=self.category,
            recorded_by=self.creator_user
        )
        
        self.client = APIClient()

    def test_creator_can_edit_own_expense(self):
        """Creator can edit their own expense."""
        self.client.force_authenticate(user=self.creator_user)
        response = self.client.patch(
            f'/api/finance/expenses/{self.expense.id}/',
            {'amount': '2000.00'},
            headers={'X-School-ID': str(self.school.id)}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.expense.refresh_from_db()
        self.assertEqual(self.expense.amount, Decimal('2000.00'))

    def test_other_user_cannot_edit_expense(self):
        """Non-creator, non-admin cannot edit expense."""
        self.client.force_authenticate(user=self.other_user)
        response = self.client.patch(
            f'/api/finance/expenses/{self.expense.id}/',
            {'amount': '3000.00'},
            headers={'X-School-ID': str(self.school.id)}
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('only edit expenses you recorded', response.data['detail'].lower())

    def test_admin_can_edit_any_expense(self):
        """Admin can edit any expense."""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.patch(
            f'/api/finance/expenses/{self.expense.id}/',
            {'amount': '4000.00'},
            headers={'X-School-ID': str(self.school.id)}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.expense.refresh_from_db()
        self.assertEqual(self.expense.amount, Decimal('4000.00'))

    def test_other_user_cannot_delete_expense(self):
        """Non-creator, non-admin cannot delete expense."""
        self.client.force_authenticate(user=self.other_user)
        response = self.client.delete(
            f'/api/finance/expenses/{self.expense.id}/',
            headers={'X-School-ID': str(self.school.id)}
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Expense.objects.filter(id=self.expense.id).exists())

    def test_creator_can_delete_own_expense(self):
        """Creator can delete their own expense."""
        self.client.force_authenticate(user=self.creator_user)
        response = self.client.delete(
            f'/api/finance/expenses/{self.expense.id}/',
            headers={'X-School-ID': str(self.school.id)}
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Expense.objects.filter(id=self.expense.id).exists())

    # Add similar tests for OtherIncome and Transfer...
```

#### 4.2 Frontend Manual Testing Checklist

**Test Scenario 1: Admin User**
- [ ] Can see all audit fields (recorded_by, created_at)
- [ ] Can edit any expense/income/transfer
- [ ] Can delete any expense/income/transfer

**Test Scenario 2: Creator (Accountant)**
- [ ] Can see audit fields
- [ ] Can edit own entries
- [ ] Can delete own entries
- [ ] Cannot edit entries created by others (button disabled or error shown)
- [ ] Cannot delete entries created by others

**Test Scenario 3: Other User (Staff)**
- [ ] Can see audit fields (read-only mode)
- [ ] Cannot see Edit/Delete buttons (canWrite = false)

---

## Migration Requirements

**Database Migrations:** NONE (all fields already exist)

**Deployment Steps:**
1. Deploy backend code (add perform_update/perform_destroy methods)
2. Deploy frontend code (add audit columns and permission checks)
3. No downtime required

---

## Success Criteria

### Backend
- [ ] Expense update/delete restricted to creator or admin
- [ ] OtherIncome update/delete restricted to creator or admin
- [ ] Transfer update/delete restricted to creator or admin
- [ ] Clear error messages returned on permission denial
- [ ] Tests pass (test_finance_edit_permissions.py)

### Frontend
- [ ] Expense page shows `recorded_by_name` and `created_at` (both mobile and desktop)
- [ ] OtherIncome page shows `recorded_by_name` and `created_at`
- [ ] Transfer section shows `recorded_by_name` and `created_at`
- [ ] Edit/Delete buttons hidden or disabled for entries user cannot modify
- [ ] Permission denied errors shown with clear messages
- [ ] No console errors

---

## Files to Modify

### Backend (3 files)
1. **backend/finance/views.py**
   - Add `can_edit_finance_entry()` helper function
   - Add `perform_update()` to ExpenseViewSet
   - Add `perform_destroy()` to ExpenseViewSet
   - Add `perform_update()` to OtherIncomeViewSet
   - Add `perform_destroy()` to OtherIncomeViewSet
   - Add `perform_update()` to TransferViewSet
   - Add `perform_destroy()` to TransferViewSet

2. **backend/test_finance_edit_permissions.py** (CREATE NEW)
   - Test suite for permission enforcement

3. **backend/finance/serializers.py** (VERIFY ONLY)
   - Confirm `recorded_by_name`, `created_at` in all three serializers

### Frontend (6 files)
1. **frontend/src/pages/ExpensesPage.jsx**
   - Add `created_at` column to Expense table (desktop)
   - Add audit info to mobile cards
   - Add `canEditExpense()` helper
   - Update Edit/Delete button logic
   - Add `created_at` to Transfer table
   - Add `canEditTransfer()` helper
   - Update Transfer Delete button logic

2. **frontend/src/pages/fee-collection/OtherIncomePage.jsx**
   - Add `recorded_by_name` and `created_at` columns (desktop)
   - Add audit info to mobile cards
   - Add `canEditIncome()` helper
   - Update Delete button logic

3. **frontend/src/pages/fee-collection/FeeTable.jsx**
   - Add `Account` column (which account received payment)
   - Add `Collected By` column (who collected payment)
   - Add `Collected At` column (timestamp)
   - Add audit info to mobile cards
   - No additional permission checks needed (already has canWrite)

4. **frontend/src/pages/fee-collection/FeeCollectPage.jsx**
   - Import `FeeSummaryCards` component
   - Add filtered summary statistics display above table
   - Show statistics that update based on applied filters

5. **frontend/src/pages/fee-collection/useFeeCollection.js**
   - Add `filteredSummaryData` computation
   - Return `filteredSummaryData` from hook

6. **frontend/src/pages/fee-collection/FeeSummaryCards.jsx**
   - Add conditional rendering for `total_students` metric
   - Update grid layout to accommodate 5 cards (or keep 4 with subtitle)

---

## Timeline Estimate

| Phase | Task | Effort | Priority |
|-------|------|--------|----------|
| 1.1 | Add helper function | 15 min | HIGH |
| 1.2-1.5 | Add perform_update/destroy to 3 ViewSets | 45 min | HIGH |
| 2.1 | Update ExpensesPage (Expense table) | 30 min | HIGH |
| 2.2 | Update OtherIncomePage | 30 min | HIGH |
| 2.3 | Update ExpensesPage (Transfer table) | 25 min | HIGH |
| 2.4 | Update FeeTable (Fee collection audit) | 35 min | HIGH |
| 2.5 | Add filtered statistics (FeeCollectPage) | 30 min | HIGH |
| 3 | Error handling | 20 min | MEDIUM |
| 4 | Testing | 45 min | HIGH |

**Total:** ~4.5 hours

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users frustrated by permission denial | Medium | Clear error messages explaining why |
| Admins confused about who can edit | Low | Audit trail shows creator, UI indicates permissions |
| Breaking existing edit workflows | Low | Only adds restrictions, doesn't change happy path |
| Frontend/Backend mismatch | Medium | Test both layers, sync deployment |

---

## Post-Implementation Monitoring

**Week 1:**
- Monitor API logs for 403 PermissionDenied errors
- Check if users contacting support about "can't edit"
- Verify audit fields displaying correctly

**Week 2:**
- Run audit report: `Expense.objects.filter(recorded_by__isnull=True).count()` → Should be 18 (historical seed data)
- Confirm no new NULL recorded_by records

---

## Future Enhancements (Out of Scope)

1. **Edit History:** Track who edited an entry and when (separate EditLog model)
2. **Approval Workflow:** Require admin approval for large transactions
3. **Bulk Edit:** Allow admins to reassign entries if creator leaves
4. **Export Audit Trail:** Download CSV of who did what when

---

## Related Documentation

- **AUDIT_TRAIL_IMPLEMENTATION_PLAN.md** — Model-level validation for recorded_by
- **AUDIT_TRAIL_COMPLETE.md** — Completed audit trail enforcement summary
- **BACKEND_APPS.md** — Finance models reference
- **API_ENDPOINTS.md** — Finance API routes

---

## Questions & Answers

**Q: Can creator still edit after entry is old?**  
A: Yes, no time-based restrictions. Only user-based.

**Q: What if entry has NULL recorded_by (old seed data)?**  
A: Permission check will fail for non-admins (NULL != user.id). Only admins can edit NULL entries.

**Q: Can we make some users "Finance Managers" who can edit anything?**  
A: Yes, add that role to ADMIN_ROLES in core/permissions.py if needed.

**Q: Does this affect FeePayment edits?**  
A: No, FeePayment uses `collected_by` and already has custom permission logic.

---

**Status:** Ready for implementation  
**Last Updated:** March 9, 2026  
**Approved By:** [Pending Review]
