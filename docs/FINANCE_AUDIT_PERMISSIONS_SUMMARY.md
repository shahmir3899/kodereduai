# Finance Audit & Edit Permissions - Quick Summary

**Status:** ✅ PLAN COMPLETE - Ready for Implementation  
**Full Details:** See [FINANCE_AUDIT_PERMISSIONS_PLAN.md](FINANCE_AUDIT_PERMISSIONS_PLAN.md)

---

## What This Adds

### 1. Edit Restrictions (Backend)
**Rule:** Only the person who recorded an entry OR an admin can edit/delete it

**Who Can Edit:**
- ✅ SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL → Can edit ANYTHING
- ✅ Original creator → Can edit ONLY their own entries
- ❌ Other users → Cannot edit entries they didn't create

**Applies To:** Expense, OtherIncome, Transfer

### 2. Audit Trail Display (Frontend)
**Rule:** Show WHO recorded each transaction and WHEN (actual timestamp)

**New Columns in Tables:**
- `Recorded By` → Username who created entry (or `Collected By` for fees)
- `Created At` → System timestamp (e.g., "Mar 9, 02:25 PM")
- `Account` → Which account received/paid money (especially important for fees)

**Applies To:** Expense page, Other Income page, Transfer section, Fee Collection page

### 3. Fee Collection Filtered Statistics
**Rule:** Display summary statistics that update based on applied filters

**Statistics Displayed:**
- `Total Students` → Count of students in filtered results
- `Total Payable` → Sum of amount_due for filtered payments
- `Total Paid` → Sum of amount_paid for filtered payments
- `Balance` → Total Payable - Total Paid

**Behavior:** Statistics update automatically when filters change (class, status, fee type)

**Applies To:** Fee Collection page (`/finance/fees/collect`)

---

## Implementation Checklist

### Backend (3 changes in `backend/finance/views.py`)

1. **Add Helper Function** (at module level):
```python
def can_edit_finance_entry(request, entry):
    """Check if user can edit/delete a finance entry."""
    from core.permissions import get_effective_role, ADMIN_ROLES
    
    # Admins can edit anything
    role = get_effective_role(request)
    if role in ADMIN_ROLES:
        return True
    
    # User can edit own entries
    if entry.recorded_by_id == request.user.id:
        return True
    
    return False
```

2. **Add to ExpenseViewSet** (3 ViewSets total):
```python
def perform_update(self, serializer):
    instance = serializer.instance
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only edit expenses you recorded. "
            "Contact an admin to modify this entry."
        )
    serializer.save()

def perform_destroy(self, instance):
    if not can_edit_finance_entry(self.request, instance):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            "You can only delete expenses you recorded. "
            "Contact an admin to remove this entry."
        )
    instance.delete()
```

3. **Repeat for OtherIncomeViewSet and TransferViewSet** (same pattern)

### Frontend (3 files)

1. **ExpensesPage.jsx** — Add columns:
```jsx
// Desktop table: Add "Created At" column
<th>Created At</th>
// In tbody:
<td className="text-xs text-gray-400">
  {new Date(expense.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', 
    hour: '2-digit', minute: '2-digit'
  })}
</td>

// Add permission check helper:
const canEditExpense = (expense) => {
  if (!user) return false
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user.role)
  return isAdmin || expense.recorded_by === user.id
}

// Use in Edit/Delete buttons:
{canWrite && canEditExpense(expense) && (
  <button onClick={() => openEdit(expense)}>Edit</button>
)}
+4. **FeeCollectPage.jsx + useFeeCollection.js** — Add filtered statistics:
+
+```jsx
+// In useFeeCollection.js - add filtered summary computation
+const filteredSummaryData = useMemo(
+  () => {
+    if (filteredPayments.length === 0) return null
+    return {
+      total_students: filteredPayments.length,
+      total_due: filteredPayments.reduce((s, p) => s + Number(p.amount_due), 0),
+      total_collected: filteredPayments.reduce((s, p) => s + Number(p.amount_paid), 0),
+      total_pending: /* calculated as total_due - total_collected */
+    }
+  },
+  [filteredPayments]
+)
+
+// In FeeCollectPage.jsx - add statistics display
+import FeeSummaryCards from './FeeSummaryCards'
+
+{data.filteredSummaryData && (
+  <FeeSummaryCards summaryData={data.filteredSummaryData} />
+)}
+```
+
+**Result:** Statistics update automatically when filters change (class/status/fee type)
+
```

2. **OtherIncomePage.jsx** — Add columns and permission check:
```jsx
// Add "Recorded By" and "Created At" columns
<th>Recorded By</th>
<th>Created At</th>

// In tbody:
<td className="text-sm text-gray-500">{item.recorded_by_name || '-'}</td>
<td className="text-xs text-gray-400">
  {new Date(item.created_at).toLocaleString()}
</td>

// Add permission check:
const canEditIncome = (item) => {
  if (!user) return false
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user.role)
  return isAdmin || item.recorded_by === user.id
}
```

3. **FeeTable.jsx** — Add audit columns (for fee collection):
```jsx
// Add after Status column:
<th>Account</th>
<th>Collected By</th>
<th>Collected At</th>

// In tbody:
<td className="text-xs text-gray-600">{payment.account_name || '-'}</td>
<td className="text-xs text-gray-600">{payment.collected_by_name || '-'}</td>
<td className="text-xs text-gray-400">
  {payment.created_at && new Date(payment.created_at).toLocaleString()}
</td>

// No additional permission check - fees deletable by any accountant/admin (canWrite check already exists)
```

---

## Example Scenarios

### Scenario 1: Accountant Records Expense
1. Accountant "John" creates expense for PKR 5,000
2. API sets `recorded_by = John's user ID`
3. Table shows: "Recorded By: John" | "Created At: Mar 9, 02:15 PM"
4. John can edit/delete this entry ✅
5. Other accountant "Mary" cannot edit/delete ❌
6. Admin "Principal" can edit/delete ✅

### Scenario 2: Admin Creates Income
1. Admin "Principal" creates income PKR 10,000
2. API sets `recorded_by = Principal's user ID`
3. Table shows: "Recorded By: Principal" | "Created At: Mar 9, 03:30 PM"
4. All admins can edit/delete ✅
5. Accountants cannot edit/delete ❌

### Scenario 3: User Tries Unauthorized Edit
1. Mary tries to edit John's expense via API
2. Backend checks: `Mary.id != John.id` and `Mary is not admin`
3. API returns 403 Forbidden: "You can only edit expenses you recorded"
4. Frontend shows error toast with this message

---

## Testing Commands

### Backend Tests
```bash
cd backend
python manage.py test test_finance_edit_permissions -v 2
```

### Frontend Manual Test
1. Login as Accountant "John"
2. Create an expense
3. Try to edit → Should work ✅
4. Logout, login as Accountant "Mary"
5. Try to edit John's expense → Should fail ❌ (button disabled or error)
6. Logout, login as Admin "Principal"
7. Try to edit John's expense → Should work ✅

---

## Migration Status

**Database Migrations:** ✅ NONE NEEDED (all fields already exist)

**Deployment:**
- Step 1: Deploy backend changes
- Step 2: Deploy frontend changes  
- Zero downtime

---

## Files Modified

### Backend
- `backend/finance/views.py` — Add helper + 3 ViewSet methods each

### Frontend
+ `frontend/src/pages/ExpensesPage.jsx` — Add columns + permission checks
+ `frontend/src/pages/fee-collection/OtherIncomePage.jsx` — Add columns + permission checks
+ `frontend/src/pages/fee-collection/FeeTable.jsx` — Add audit columns (Account, Collected By, Collected At)
+ `frontend/src/pages/fee-collection/FeeCollectPage.jsx` — Add filtered statistics display
+ `frontend/src/pages/fee-collection/useFeeCollection.js` — Add filteredSummaryData computation
+ `frontend/src/pages/fee-collection/FeeSummaryCards.jsx` — Add total_students metric

### New Files
- `backend/test_finance_edit_permissions.py` — Test suite
- `docs/FINANCE_AUDIT_PERMISSIONS_PLAN.md` — This plan (detailed)
- `docs/FINANCE_AUDIT_PERMISSIONS_SUMMARY.md` — This summary

---

## Time Estimate

+**Backend:** 1 hour  
+**Frontend:** 2.5 hours (6 files)  
+**Testing:** 1 hour  
+**Total:** ~4.5 hours

---

## Current Status vs After Implementation

### Before (Current State)
| Feature | Status |
|---------|--------|
| recorded_by field exists | ✅ Yes |
| API returns recorded_by | ✅ Yes |
| Frontend shows recorded_by | ⚠️ Partially (Expense desktop only) |
| Frontend shows created_at | ❌ No |
| Frontend shows account | ❌ No (except in forms) |
+| Fee page shows filtered stats | ❌ No |
| Edit permission check | ❌ No (anyone can edit) |

### After Implementation
| Feature | Status |
|---------|--------|
| recorded_by field exists | ✅ Yes |
| API returns recorded_by | ✅ Yes |
| Frontend shows recorded_by | ✅ Yes (all pages, mobile + desktop) |
| Frontend shows created_at | ✅ Yes (all pages) |
| Frontend shows account | ✅ Yes (all pages) |
+| Fee page shows filtered stats | ✅ Yes (updates with filters) |
| Edit permission check | ✅ Yes (backend + frontend) |

---

## Key Benefits

1. **Accountability:** Clear audit trail of who did what when
2. **Security:** Prevents unauthorized modifications
3. **Transparency:** Users see creator and timestamp for each transaction
4. **Compliance:** Meets audit requirements for financial records
5. **User-Friendly:** Clear error messages when permission denied

---

## Questions?

**Q: What happens to old entries with NULL recorded_by?**  
A: Only admins can edit them (NULL != any user.id)

**Q: Can we add more roles to admin list?**  
A: Yes, edit `ADMIN_ROLES` in `backend/core/permissions.py`

**Q: Does this work with multi-school?**  
A: Yes, permission checks are school-aware via TenantMiddleware

---

**Ready to implement? See [FINANCE_AUDIT_PERMISSIONS_PLAN.md](FINANCE_AUDIT_PERMISSIONS_PLAN.md) for detailed code snippets.**
