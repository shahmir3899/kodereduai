# Audit Trail Implementation Plan - Finance Transactions

**Date:** March 9, 2026  
**Status:** APPROVED FOR IMPLEMENTATION  
**Decision:** Option 2 - Leave existing NULL records, prevent future ones

---

## Executive Summary

Finance transactions (Expense, OtherIncome, Transfer) require complete audit trail for compliance and accountability. Current code properly populates `recorded_by` at the API layer, but seed data lacks this field. This plan enforces audit requirements going forward while documenting legacy gaps.

---

## Current State Analysis

### ✓ What's Working
- **API Layer:** All three ViewSets (`ExpenseViewSet`, `OtherIncomeViewSet`, `TransferViewSet`) correctly set `recorded_by=request.user` in `perform_create()`
- **Transfer Model:** 0% NULL records (8/8 have recorded_by)
- **System Timestamps:** All models have `created_at` and `updated_at` fields

### ⚠️ Data Quality Issues
| Model | Total | NULL recorded_by | % | Root Cause |
|-------|-------|------------------|---|-----------|
| Expense | 73 | 18 | 24.7% | Seed/fixture data (Feb 11, 2026) |
| OtherIncome | 6 | 1 | 16.7% | Seed/fixture data (Feb 11, 2026) |
| Transfer | 8 | 0 | 0% | ✓ GOOD |

All NULL records batch-created on 2026-02-11 14:53:3x via direct ORM, not API.

---

## Audit Trail Fields (Per Model)

### Expense Model
```python
recorded_by = ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
created_at = DateTimeField(auto_now_add=True)
updated_at = DateTimeField(auto_now=True)
date = DateField()  # Business date from frontend
```

**Meaning:**
- `date`: What day the expense occurred (from user input)
- `recorded_by`: WHO recorded it (FK to User)
- `created_at`: WHEN it was entered into system (system timestamp)
- `updated_at`: Last modification time

### OtherIncome Model
Same structure as Expense.

### Transfer Model
Same structure, plus `recorded_by` already enforced in code.

---

## Implementation Plan

### Phase 1: Model-Level Validation (IMMEDIATE)
**Goal:** Prevent future NULL `recorded_by` values

#### 1a. Update Expense Model
Add validation in `save()` method:
```python
def save(self, *args, **kwargs):
    # Existing period lock checks...
    
    # ✓ NEW: Audit trail validation
    if not self.recorded_by_id:
        raise ValidationError(
            "Audit trail violation: recorded_by cannot be NULL. "
            "All expenses must track who recorded them."
        )
    
    super().save(*args, **kwargs)
```

#### 1b. Update OtherIncome Model
Same as Expense.

#### 1c. Update Transfer Model
Same as Expense (already has code, just ensure it's active).

#### 1d. Update Serializers
Add read-only field to ensure frontend displays recorded user:
```python
class ExpenseSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.CharField(
        source='recorded_by.get_full_name', 
        read_only=True
    )
    # ...
```

---

### Phase 2: Backfill Strategy (OPTIONAL, POST-GO-LIVE)
**Decision:** Skip for now. Legacy seed data documented as limitation.

If needed later:
```bash
# Management command to identify and fix
python manage.py backfill_audit_trail --dry-run
```

---

### Phase 3: API Documentation Updates
**Files to Update:**
1. `docs/API_ENDPOINTS.md` - Add note about recorded_by 
2. `docs/API_RESPONSES.md` - Show recorded_by in sample responses
3. `docs/BACKEND_APPS.md` - Document audit fields per model

**Document:**
- Expense, OtherIncome, Transfer all require `recorded_by`
- System automatically populates from `request.user`
- Audit trail shows WHO and WHEN, not just transaction date

---

### Phase 4: Frontend Integration
**Current Status:** ✓ Working correctly via API response

**Fields Returned:**
```json
{
  "id": 77,
  "date": "2026-03-09",
  "created_at": "2026-03-09T06:25:35.167311Z",
  "recorded_by": 15,
  "recorded_by_name": "Principal Br1"  // ← Read-only display
}
```

---

## Validation Rules (Going Forward)

| Rule | Applies To | Enforced? | Location |
|------|-----------|-----------|----------|
| recorded_by required | Expense, OtherIncome, Transfer | YES | Model.save() |
| date required | All | YES | Model validation |
| account optional | Expense, OtherIncome, Transfer | YES | Model allows NULL |
| created_at auto | All | YES | Django auto_now_add |
| updated_at auto | All | YES | Django auto_now |

---

## Test Cases (Post-Implementation)

### Test 1: API Creates Expense with Audit
```
POST /api/finance/expenses/
{
  "school": 1,
  "date": "2026-03-09",
  "amount": "5000.00",
  "category": "RENT"
}
Result: ✓ recorded_by auto-populated from request.user
```

### Test 2: Direct ORM (Legacy Pattern) Should FAIL
```python
Expense.objects.create(
    school_id=1,
    date='2026-03-09',
    amount=5000,
    recorded_by=None  # ← Should raise ValidationError
)
Result: ✗ ValidationError: recorded_by cannot be NULL
```

### Test 3: Django Admin Create Should FAIL
If admin tries to save without recorded_by:
```
Result: ✗ Form validation error shown
```

---

## Migration Strategy

### No New Migration Needed
- `recorded_by` field already exists (nullable)
- Only adding validation, not schema change
- Existing NULL values remain untouched

### Just Deploy
1. Update model `save()` methods
2. Deploy to production
3. All NEW records automatically validated
4. Existing NULL records remain (documented limitation)

---

## Documentation Updates Required

### 1. docs/BACKEND_APPS.md
Add to Finance → Audit Trail section:

```markdown
### Audit Trail Fields

**Expense, OtherIncome, Transfer models include:**
- `recorded_by`: FK → User (WHO recorded it)
  - Automatically set from `request.user` via API
  - REQUIRED going forward (validation in model.save())
- `created_at`: System timestamp of record creation
- `updated_at`: System timestamp of last modification
- `date`: Business date (from user input)

**Audit Compliance:**
All transactions created via API properly track user who recorded them.
Legacy seed data (Feb 11, 2026) has NULL recorded_by due to direct ORM loading;
documented as acceptable for test data only.
```

### 2. docs/API_ENDPOINTS.md
Add to Finance section:

```markdown
**AUDIT TRAIL ENFORCEMENT**
- POST /api/finance/expenses/ - Automatically sets recorded_by=current_user
- POST /api/finance/other-income/ - Automatically sets recorded_by=current_user
- POST /api/finance/transfers/ - Automatically sets recorded_by=current_user

Example response includes:
```json
{
  "recorded_by": 15,
  "recorded_by_name": "Principal Name",
  "created_at": "2026-03-09T06:25:35Z"
}
```
```

### 3. docs/API_RESPONSES.md
Update sample Expense response:

```json
{
  "id": 77,
  "amount": "5000.00",
  "date": "2026-03-09",
  "created_at": "2026-03-09T06:25:35.167311+00:00",
  "updated_at": "2026-03-09T06:25:35.167311+00:00",
  "recorded_by": 15,
  "recorded_by_name": "principalbr1",
  "account_name": "Principal"
}
```

---

## Timeline

| Phase | Task | Effort | Timeline |
|-------|------|--------|----------|
| 1a | Update 3 model save() methods | 30 min | TODAY |
| 1b | Update serializers (add read-only fields) | 20 min | TODAY |
| 1c | Test API validation | 30 min | TODAY |
| 2 | Update 3 docs | 45 min | TODAY |
| 3 | Deploy | 15 min | TODAY |

**Total: ~2.5 hours**

---

## Success Criteria

- [ ] Expense.save() raises ValidationError if recorded_by is NULL
- [ ] OtherIncome.save() raises ValidationError if recorded_by is NULL
- [ ] Transfer.save() raises ValidationError if recorded_by is NULL
- [ ] API responses include recorded_by_name fieldfor display
- [ ] Django admin form validation prevents NULL recorded_by
- [ ] Test: Direct ORM create() without recorded_by fails
- [ ] Test: API POST with recorded_by succeeds
- [ ] Docs updated with audit trail policy
- [ ] Team acknowledged legacy data limitation

---

## Maintenance Notes

### Future Backfill (If Needed)
If later requested to fix seed data:
```bash
# Create management command
backend/finance/management/commands/backfill_audit_trail.py

# Usage
python manage.py backfill_audit_trail --school-id 1 --set-user-id 5 --dry-run
```

### Monitoring
- Alert if bulk_create() used without recorded_by
- Periodic audit: `Expense.objects.filter(recorded_by__isnull=True).count()`
- Should always be 0 after deployment

---

## Decision Log

**Decision:** Option 2 (Leave existing, prevent future)  
**Rationale:**
- Seed data is immutable test data with business explanations
- Production data will have complete audit trail going forward
- Backfilling is risky without knowing true user intent
- Validation prevents repeat of problem

**Stakeholders Consulted:**
- Finance Manager: Approved audit trail enforcement
- Admin: Aware of seed data gap
- Dev Team: Confirmed implementation is low-risk

---

## Related Issues

- **Issue:** 18 Expense records (24.7%) have NULL recorded_by
- **Root Cause:** Feb 11 seed data created via direct ORM
- **Impact:** Low (test data only)
- **Fix Applied:** Model validation prevents recurrence
