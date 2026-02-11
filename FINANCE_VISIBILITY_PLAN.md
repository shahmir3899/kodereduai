# Finance Visibility Control — Option B Implementation Plan

## Overview

**Goal:** Let School Admins control which financial data Staff users can see.

**Hierarchy:**
- **Super Admin** — Platform manager, sees everything, doesn't configure per-school visibility
- **School Admin** — School owner/principal, full finance access, controls Staff visibility
- **Staff** — Hired person, sees only what School Admin allows

**Two layers of control:**
1. **Account level** — `staff_visible` flag hides entire accounts (and all their transactions)
2. **Transaction level** — `is_sensitive` flag hides individual transactions within visible accounts

**Will this break anything without Staff accounts?**
No. All new fields have safe defaults (`staff_visible=True`, `is_sensitive=False`). The filtering only activates when `request.user.is_staff_member` is True. Since no Staff users exist yet, all existing behavior remains identical. School Admins and Super Admins bypass visibility filters entirely.

---

## Current State

| Model | Fields | Staff Access |
|-------|--------|--------------|
| Account | school, name, type, opening_balance, is_active | Blocked (403) |
| FeePayment | school, student, month, year, amounts, account | Blocked (403) |
| Expense | school, category, amount, date, account | Blocked (403) |
| OtherIncome | school, category, amount, date, account | Blocked (403) |
| Transfer | school, from_account, to_account, amount, date | Blocked (403) |
| FeeStructure | school, class, student, monthly_amount | Blocked (403) |

**Current permission on ALL finance views:** `IsAuthenticated, IsSchoolAdmin, HasSchoolAccess`
- `IsSchoolAdmin` blocks Staff entirely (returns 403)
- Staff cannot access any finance endpoint

---

## Target State

| Model | New Field(s) | Staff Sees |
|-------|-------------|------------|
| Account | `staff_visible` (bool, default=True) | Only accounts where staff_visible=True |
| Expense | `is_sensitive` (bool, default=False) | Only non-sensitive, in visible accounts |
| OtherIncome | `is_sensitive` (bool, default=False) | Only non-sensitive, in visible accounts |
| Transfer | `is_sensitive` (bool, default=False) | Only non-sensitive, in visible accounts |
| FeePayment | *(no change)* | All fee payments in visible accounts (fees are not sensitive) |
| FeeStructure | *(no change)* | All (fee structures are school config, not sensitive) |

**New permission:** `IsSchoolAdminOrStaffReadOnly` — Staff gets GET access, School Admin gets full CRUD.

---

## Implementation Steps

### Step 1: Model Changes

**File: `backend/finance/models.py`**

**Account** — add 1 field:
```python
staff_visible = models.BooleanField(
    default=True,
    help_text="If False, this account and all its transactions are hidden from Staff users"
)
```

**Expense** — add 1 field:
```python
is_sensitive = models.BooleanField(
    default=False,
    help_text="If True, hidden from Staff users even if the account is visible"
)
```

**OtherIncome** — add 1 field:
```python
is_sensitive = models.BooleanField(
    default=False,
    help_text="If True, hidden from Staff users even if the account is visible"
)
```

**Transfer** — add 1 field:
```python
is_sensitive = models.BooleanField(
    default=False,
    help_text="If True, hidden from Staff users even if the account is visible"
)
```

**FeePayment** — no changes (fee payments are always visible if account is visible)
**FeeStructure** — no changes (school configuration, not transaction data)

Then run:
```
python manage.py makemigrations finance
python manage.py migrate
```

### Step 2: New Permission Class

**File: `backend/core/permissions.py`**

Add a new permission that allows Staff read-only access to finance:

```python
class IsSchoolAdminOrStaffReadOnly(permissions.BasePermission):
    """
    School Admins: full access (GET, POST, PUT, DELETE)
    Staff: read-only access (GET only)
    Others: denied
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_super_admin or request.user.is_school_admin:
            return True
        if request.user.is_staff_member and request.method in permissions.SAFE_METHODS:
            return True
        return False
```

### Step 3: Helper — Staff Visibility Filter

**File: `backend/finance/views.py`**

Add a reusable helper function at the top:

```python
def _get_staff_visible_accounts(school_id):
    """Returns IDs of accounts visible to Staff users."""
    return Account.objects.filter(
        school_id=school_id, is_active=True, staff_visible=True
    ).values_list('id', flat=True)

def _apply_staff_filters(queryset, user, school_id, account_field='account'):
    """
    If user is Staff, filter out:
    1. Transactions in hidden accounts
    2. Transactions marked as sensitive
    Returns unmodified queryset for School Admin / Super Admin.
    """
    if not user.is_staff_member:
        return queryset

    visible_account_ids = _get_staff_visible_accounts(school_id)

    # Filter to visible accounts only
    queryset = queryset.filter(**{f'{account_field}__in': visible_account_ids})

    # Filter out sensitive transactions (only if model has is_sensitive field)
    if hasattr(queryset.model, 'is_sensitive'):
        queryset = queryset.filter(is_sensitive=False)

    return queryset
```

### Step 4: Update View Permissions & Querysets

**File: `backend/finance/views.py`**

Replace `IsSchoolAdmin` with `IsSchoolAdminOrStaffReadOnly` on views that Staff should access. Update querysets to apply visibility filters.

#### AccountViewSet
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

def get_queryset(self):
    queryset = Account.objects.filter(is_active=True)
    # ... existing tenant filtering ...

    # Staff: only see staff_visible accounts
    if self.request.user.is_staff_member:
        queryset = queryset.filter(staff_visible=True)

    return queryset
```

The `balances` action also needs Staff filtering:
```python
@action(detail=False, methods=['get'])
def balances(self, request):
    school_id = _resolve_school_id(request)
    accounts = Account.objects.filter(school_id=school_id, is_active=True)

    # Staff: only visible accounts
    if request.user.is_staff_member:
        accounts = accounts.filter(staff_visible=True)

    for account in accounts:
        fee_qs = FeePayment.objects.filter(school_id=school_id, account=account)
        expense_qs = Expense.objects.filter(school_id=school_id, account=account)
        income_qs = OtherIncome.objects.filter(school_id=school_id, account=account)
        tfr_in_qs = Transfer.objects.filter(school_id=school_id, to_account=account)
        tfr_out_qs = Transfer.objects.filter(school_id=school_id, from_account=account)

        # Staff: exclude sensitive transactions from balance calc
        if request.user.is_staff_member:
            expense_qs = expense_qs.filter(is_sensitive=False)
            income_qs = income_qs.filter(is_sensitive=False)
            tfr_in_qs = tfr_in_qs.filter(is_sensitive=False)
            tfr_out_qs = tfr_out_qs.filter(is_sensitive=False)

        # ... rest of balance calculation unchanged ...
```

#### ExpenseViewSet
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

def get_queryset(self):
    # ... existing queryset logic ...
    queryset = _apply_staff_filters(queryset, self.request.user, school_id, 'account')
    return queryset
```

#### OtherIncomeViewSet
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

def get_queryset(self):
    # ... existing queryset logic ...
    queryset = _apply_staff_filters(queryset, self.request.user, school_id, 'account')
    return queryset
```

#### TransferViewSet
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

def get_queryset(self):
    # ... existing queryset logic ...
    if self.request.user.is_staff_member:
        visible_ids = _get_staff_visible_accounts(school_id)
        queryset = queryset.filter(
            from_account__in=visible_ids,
            to_account__in=visible_ids,
            is_sensitive=False
        )
    return queryset
```

#### FeePaymentViewSet
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

def get_queryset(self):
    # ... existing queryset logic ...
    # Staff: only see payments to visible accounts
    if self.request.user.is_staff_member:
        visible_ids = _get_staff_visible_accounts(school_id)
        queryset = queryset.filter(account__in=visible_ids)
    return queryset
```

#### FeeStructureViewSet
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
# No queryset changes — fee structures are school config, always visible
```

#### FinanceReportsView
```python
permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
# Apply same filters when computing report aggregations
```

#### FinanceAIChatView
```python
# Keep IsSchoolAdmin — AI chat has access to all data, not safe for Staff
permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
```

### Step 5: Serializer Changes

**File: `backend/finance/serializers.py`**

#### AccountSerializer — expose `staff_visible`:
```python
class Meta:
    fields = [..., 'staff_visible']
```

Only School Admins can see/set this field. For Staff, exclude it from response (they shouldn't know the flag exists):
```python
def get_fields(self):
    fields = super().get_fields()
    request = self.context.get('request')
    if request and request.user.is_staff_member:
        fields.pop('staff_visible', None)
    return fields
```

#### Expense/OtherIncome/Transfer Serializers — expose `is_sensitive`:
```python
class Meta:
    fields = [..., 'is_sensitive']
```

Same pattern — hide `is_sensitive` field from Staff responses.

### Step 6: Frontend — AuthContext

**File: `frontend/src/contexts/AuthContext.jsx`**

Add `isStaffMember` to the context:
```javascript
const value = {
    user,
    isAuthenticated: !!user,
    isSuperAdmin: user?.is_super_admin,
    isSchoolAdmin: user?.role === 'SCHOOL_ADMIN',
    isStaffMember: user?.role === 'STAFF',
    // ...
}
```

### Step 7: Frontend — Layout Navigation

**File: `frontend/src/components/Layout.jsx`**

Conditionally show Finance section for Staff (only if they have visible accounts):

For now, show Finance to both School Admin and Staff (Staff will just see filtered data). If a Staff user has zero visible accounts, the pages will show empty states — that's fine.

Hide finance pages that Staff should never see:
```javascript
// Finance group
{
    type: 'group',
    name: 'Finance',
    icon: CurrencyIcon,
    children: [
        { name: 'Fee Collection', href: '/finance/fees', icon: ReceiptIcon },
        { name: 'Accounts', href: '/finance/accounts', icon: BanknotesIcon },
        { name: 'Expenses', href: '/finance/expenses', icon: WalletIcon },
        // Reports only for School Admin (hide from Staff)
        ...(!isStaffMember ? [{ name: 'Reports', href: '/finance/reports', icon: ReportIcon }] : []),
    ],
},
```

### Step 8: Frontend — Accounts Page Toggle

**File: `frontend/src/pages/AccountsPage.jsx`**

Add a visibility toggle on each account card (only visible to School Admin):

```jsx
{isSchoolAdmin && (
    <button onClick={() => toggleStaffVisibility(account.id)}>
        {account.staff_visible ? '👁 Visible to Staff' : '🔒 Hidden from Staff'}
    </button>
)}
```

### Step 9: Frontend — Sensitive Transaction Toggle

On Expense/OtherIncome/Transfer create/edit forms, add a checkbox (School Admin only):

```jsx
{isSchoolAdmin && (
    <label className="flex items-center gap-2">
        <input type="checkbox" checked={isSensitive} onChange={...} />
        <span className="text-sm">Mark as sensitive (hide from Staff)</span>
    </label>
)}
```

---

## Summary of Changes

### Backend Files Modified:
| File | Changes |
|------|---------|
| `finance/models.py` | Add `staff_visible` to Account, `is_sensitive` to Expense/OtherIncome/Transfer |
| `finance/views.py` | Add `_apply_staff_filters()` helper, update permissions on 6 ViewSets, update `balances` action |
| `finance/serializers.py` | Expose new fields, hide visibility fields from Staff responses |
| `core/permissions.py` | Add `IsSchoolAdminOrStaffReadOnly` permission class |
| `finance/migrations/` | 1 new migration file (auto-generated) |

### Frontend Files Modified:
| File | Changes |
|------|---------|
| `contexts/AuthContext.jsx` | Add `isStaffMember` to context |
| `components/Layout.jsx` | Conditionally hide Reports from Staff |
| `pages/AccountsPage.jsx` | Add staff_visible toggle for School Admin |
| `pages/ExpensesPage.jsx` | Add is_sensitive checkbox on forms |

### New Fields (all with safe defaults):
| Model | Field | Type | Default | Effect |
|-------|-------|------|---------|--------|
| Account | `staff_visible` | Boolean | `True` | All accounts visible by default |
| Expense | `is_sensitive` | Boolean | `False` | All expenses visible by default |
| OtherIncome | `is_sensitive` | Boolean | `False` | All income visible by default |
| Transfer | `is_sensitive` | Boolean | `False` | All transfers visible by default |

### Zero Risk of Breaking Existing Behavior:
- Defaults ensure all data remains visible (same as current behavior)
- Filters only activate for `is_staff_member` users (none exist yet)
- School Admin and Super Admin querysets are untouched
- No existing API contracts change — new fields are additive
- Migration is non-destructive (adding nullable/defaulted columns)

---

## Data Flow: What Staff Sees

```
Staff requests GET /api/finance/accounts/balances/
    │
    ├── Account "Fee Cash" (staff_visible=true)
    │   ├── FeePayment: Ali paid 5000     ✅ visible (fees always visible)
    │   ├── Expense: Stationery 500       ✅ visible (is_sensitive=false)
    │   ├── Expense: Owner Cash 20000     ❌ hidden  (is_sensitive=true)
    │   └── Balance: BBF + fees - visible_expenses only
    │
    ├── Account "School Bank" (staff_visible=true)
    │   ├── Transfer In: from Cash 10000  ✅ visible (is_sensitive=false)
    │   ├── Transfer Out: Owner 50000     ❌ hidden  (is_sensitive=true)
    │   └── Balance: excludes sensitive transfers
    │
    └── Account "Principal Personal" (staff_visible=false)
        └── ❌ entire account hidden (not even listed)
```

**Important:** Staff sees a **different balance** than School Admin for accounts with sensitive transactions. This is by design — the Staff balance reflects only the transactions they're allowed to see.
