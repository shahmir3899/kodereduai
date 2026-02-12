# Multi-School Architecture Guide

> **Date:** February 11, 2026
> **Scope:** Organization + UserSchoolMembership + Shared Accounts

---

## What Changed (Summary)

The platform moved from a **1:1 User-School** model to a **Many-to-Many** model via a membership table. This enables:

- One person managing multiple school branches with a single login
- Per-school roles (Admin at Branch 1, Staff at Branch 2)
- Shared financial accounts across branches (e.g. Shah Mir, Abdul Abbas)
- A school switcher in the frontend navbar

---

## New Models

### Organization (`schools.Organization`)

Top-level entity grouping school branches.

| Field | Type | Notes |
|-------|------|-------|
| name | CharField(200) | e.g. "The Focus Montessori" |
| slug | SlugField(50, unique) | e.g. "focus-montessori" |
| logo | URLField (nullable) | |
| is_active | BooleanField | |

### UserSchoolMembership (`schools.UserSchoolMembership`)

M2M pivot between User and School with per-school role.

| Field | Type | Notes |
|-------|------|-------|
| user | FK(User) | related_name='school_memberships' |
| school | FK(School) | related_name='memberships' |
| role | CharField | `SCHOOL_ADMIN` or `STAFF` |
| is_default | BooleanField | Which school loads on login (one per user) |
| is_active | BooleanField | Soft-delete membership |

**Constraint:** `unique_together = ('user', 'school')`

**Auto-behavior:** `save()` ensures only one `is_default=True` per user.

---

## Modified Models

### School

Added: `organization = FK(Organization, null=True, related_name='schools')`

### User

Added:
- `organization = FK(Organization, null=True, related_name='users')`

Kept (deprecated):
- `school = FK(School)` -- synced from default membership. Will be removed in a future release.

New methods:
```python
user.get_default_membership()       # Returns UserSchoolMembership or None
user.get_accessible_school_ids()    # Returns [1, 2, 3] -- all active memberships
user.get_role_for_school(school_id) # Returns 'SCHOOL_ADMIN', 'STAFF', or None
user.can_access_school(school_id)   # True if membership exists (or super admin)
```

### Account (`finance.Account`)

- `school` FK is now **nullable** (`null=True, blank=True`)
- Added: `organization = FK(Organization, null=True, related_name='accounts')`
- Uniqueness: Two conditional constraints replace the old `unique_together`:
  - `unique_account_name_per_school` -- when school IS NOT NULL
  - `unique_account_name_per_org` -- when school IS NULL (shared accounts)

**Shared account:** An account with `school=NULL` and `organization` set. Its balance is computed by summing transactions across ALL schools in that organization.

**School-specific account:** An account with `school` set. Its balance is computed from that school's transactions only.

---

## How Tenancy Works Now

### Request Flow

```
1. Request arrives
2. TenantMiddleware.process_request()
   - Extracts subdomain (if any) -> sets tenant_school_id
3. JWT Authentication runs
4. TenantMiddleware.process_view()
   - Populates tenant_schools from user.get_accessible_school_ids()
   - Resolves active school: X-School-ID header > subdomain > default membership
   - Sets request.tenant_school_id and request.tenant_school
5. View runs
   - TenantQuerySetMixin auto-filters by school_id__in=tenant_schools
   - perform_create auto-sets school_id from tenant_school_id
```

### Active School Resolution (priority order)

1. `X-School-ID` HTTP header (frontend sends this)
2. Subdomain from host
3. User's default membership school
4. User's school FK (deprecated fallback)

### Getting School ID in Views

```python
# In any view:
school_id = getattr(request, 'tenant_school_id', None)

# In finance views (with extra fallbacks):
school_id = _resolve_school_id(request)

# For school object:
school = getattr(request, 'tenant_school', None)
```

### Permissions

All permission classes now use `get_effective_role(request)` which checks the user's membership role for the **active school**, not the global `User.role`.

```python
from core.permissions import get_effective_role

role = get_effective_role(request)  # 'SUPER_ADMIN', 'SCHOOL_ADMIN', or 'STAFF'
```

This means a user can be SCHOOL_ADMIN at Branch 1 and STAFF at Branch 2. When they switch schools, their permissions change automatically.

---

## API Changes

### Login Response (`POST /api/auth/login/`)

New fields in `response.data.user`:

```json
{
  "id": 1,
  "username": "anilariaz",
  "role": "SCHOOL_ADMIN",
  "school_id": 1,
  "school_name": "The Focus Montessori and School",
  "is_super_admin": false,
  "organization_id": 1,
  "organization_name": "The Focus Montessori",
  "schools": [
    { "id": 1, "name": "The Focus Montessori and School", "role": "SCHOOL_ADMIN", "is_default": true },
    { "id": 2, "name": "Branch 2", "role": "STAFF", "is_default": false }
  ]
}
```

### Current User (`GET /api/auth/me/`)

Same new fields: `organization`, `organization_name`, `schools` list.

### Switch School (`POST /api/auth/switch-school/`)

```json
// Request
{ "school_id": 2 }

// Response
{ "school_id": 2, "school_name": "Branch 2", "role": "STAFF" }
```

### X-School-ID Header

Every API request from the frontend includes:
```
X-School-ID: <active_school_id>
```

This is set automatically by the axios interceptor in `api.js` from `localStorage.getItem('active_school_id')`.

### Account Balances (`GET /api/finance/accounts/balances/`)

Response now includes `is_shared` flag:

```json
{
  "accounts": [
    { "name": "Principal", "is_shared": false, "net_balance": 246700 },
    { "name": "Shah Mir", "is_shared": true, "net_balance": -1000 }
  ]
}
```

---

## Frontend Architecture

### AuthContext

```jsx
const { user, activeSchool, switchSchool, isSchoolAdmin, isStaffMember } = useAuth()

// activeSchool = { id, name, role, is_default }
// isSchoolAdmin uses activeSchool.role, not user.role

// Switch school (triggers page reload):
await switchSchool(newSchoolId)
```

### SchoolSwitcher Component

- Lives in the top navbar (Layout.jsx)
- Only renders dropdown when `user.schools.length > 1`
- Single-school users see plain text school name
- Switching calls `switchSchool()` which saves to localStorage and reloads

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `access_token` | JWT access token |
| `refresh_token` | JWT refresh token |
| `active_school_id` | Currently active school (sent as X-School-ID header) |

### Page Pattern

All pages use `activeSchool?.id` instead of `user?.school_id`:

```jsx
const { activeSchool } = useAuth()

const { data } = useQuery({
  queryKey: ['classes', activeSchool?.id],
  queryFn: () => classesApi.getClasses({ school_id: activeSchool?.id }),
  enabled: !!activeSchool?.id,
})
```

---

## How to Add a New School (Branch 2)

### Via Django Shell

```python
from schools.models import Organization, School, UserSchoolMembership
from users.models import User

org = Organization.objects.get(slug='focus-montessori')

# Create school
school2 = School.objects.create(
    organization=org,
    name='Branch 2',
    subdomain='branch2',
)

# Give existing user access
user = User.objects.get(username='anilariaz')
UserSchoolMembership.objects.create(
    user=user,
    school=school2,
    role='SCHOOL_ADMIN',
    is_default=False,
    is_active=True,
)
```

### Making an Account Shared (Org-Level)

```python
from finance.models import Account

account = Account.objects.get(name='Shah Mir', school_id=1)
account.school = None  # Remove school-specific binding
account.organization = org
account.save()
```

After this, Shah Mir's balance will be computed from transactions across ALL schools in the org.

---

## Migration History

| # | Migration | What it does |
|---|-----------|-------------|
| schools.0004 | Schema | Creates Organization, UserSchoolMembership, adds School.organization |
| users.0002 | Schema | Adds User.organization, alters User.school help_text |
| finance.0006 | Schema | Account.school nullable, Account.organization, UniqueConstraints |
| schools.0005 | Data | Creates "The Focus Montessori" org, links schools/users/accounts, creates memberships |

---

## What Did NOT Change

- **11 models** keep their `school` FK as-is: Student, Class, FeePayment, Expense, Transfer, OtherIncome, FeeStructure, AttendanceUpload, AttendanceRecord, AttendanceFeedback, FinanceAIChatMessage
- **All URL routes** -- no new pages or route changes
- **Frontend routing** (App.jsx) -- ProtectedRoute logic unchanged
- **Finance serializers** -- unchanged
- **User.role field** -- stays as "max privilege" level; membership role used for per-school checks
- **Existing scripts** (sync_excel.py, fix_cl1a.py) -- still work since they use school_id directly

---

## Future Work

1. **Remove User.school FK** -- once all code uses memberships, drop the deprecated field
2. **Admin UI for memberships** -- currently memberships are created via shell/scripts
3. **Admin UI for organizations** -- create/edit orgs from the Super Admin panel
4. **Cross-school reports** -- consolidated financial reports across all branches in an org
5. **Shared account UI** -- ability to mark accounts as shared from the Accounts page
