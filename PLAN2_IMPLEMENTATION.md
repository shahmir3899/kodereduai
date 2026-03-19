# Plan 2 Implementation - Account Ownership Model

## Status: IN PROGRESS

## Objectives
1. **Admin-only sensitive marking:** Only ADMIN_ROLES can create/mark entries as sensitive
2. **Account ownership model:** Non-admin users see only accounts they own or marked staff_visible
3. **Issue 2 Complete Fix:** Sensitive data no longer affects balance calculations

---

## Part 1: Database Migration ✅

### Migration Created
- **File:** `finance/migrations/0017_add_account_owner_field.py`
- **Change:** Added `account_owner` ForeignKey to Account model (nullable)
- **Status:** Ready to apply

---

## Part 2: Model Changes

### Account Model (finance/models.py) ✅
- Added `account_owner` field (ForeignKey to User, nullable)
- Accounts can optionally have an owner
- Staff can see accounts via `staff_visible` flag OR `account_owner=them`

---

## Part 3: View Permission Changes (IN PROGRESS)

### Changes Required:

#### 3.1 ExpenseViewSet.perform_create() - Restrict sensitive marking
- Only ADMIN_ROLES can set `is_sensitive=True`
- PRINCIPAL/STAFF/TEACHER cannot create sensitive entries
- Raise PermissionDenied if non-admin tries

#### 3.2 OtherIncomeViewSet.perform_create() - Same as 3.1

#### 3.3 TransferViewSet.perform_create() - Same as 3.1

#### 3.4 AccountViewSet.get_queryset() - Filter by ownership
- Non-admin users: see accounts where `account_owner=user` OR `staff_visible=True`
- Admin users: see all accounts
- Apply at queryset level

#### 3.5 FeePaymentViewSet - Keep existing account visibility rules
- Already uses staff_visible accounts
- No changes needed here

---

## Part 4: Serializer Validation

### Changes Required:
- Remove is_sensitive field from ExpenseCreateSerializer for non-admins
- Remove is_sensitive field from OtherIncomeCreateSerializer for non-admins
- Remove is_sensitive field from TransferCreateSerializer for non-admins
- Validate in perform_create before saving

---

## Files to Modify

1. ✅ finance/models.py (Account model - account_owner field)
2. ⏳ finance/migrations/0017_add_account_owner_field.py (created)
3. ⏳ finance/views.py (5 viewsets + 5 perform_create methods)
4. ⏳ finance/serializers.py (3 create serializers)

---

## Tests to Create

1. Admin can mark expenses sensitive
2. Non-admin cannot mark expenses sensitive
3. Non-admin cannot see others' accounts (not staff_visible)
4. Non-admin can see own account (account_owner=user)
5. Non-admin can see staff_visible accounts
6. Admin sees all accounts regardless

---

## Estimated Time: 2-3 hours implementation + testing

## Risk Level: MEDIUM
- Requires database migration
- Changes access control logic
- Data migration may be needed for existing accounts
