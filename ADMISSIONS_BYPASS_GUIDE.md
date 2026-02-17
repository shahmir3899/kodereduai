# Admissions Bypass Logic Guide

**Date**: February 16, 2026  
**Feature**: Phase 5 - Configurable Workflow with Bypass Support

---

## Overview

The admissions system now supports **stage bypass** for sessions that enable it. This allows staff to skip stages or jump directly to specific stages in the admission pipeline when needed, while still maintaining data integrity and audit trails.

---

## How Bypass Works

### **1. Session Configuration**

To enable bypass for a session, set `allow_stage_bypass = True`:

```python
session = AdmissionSession.objects.create(
    ...
    workflow_type='STANDARD',
    allow_stage_bypass=True,  # Enable bypass
    ...
)
```

### **2. Without Bypass (Default)**

```
NEW → CONTACTED → FORM_SUBMITTED → APPROVED → PAYMENT_PENDING → ENROLLED

Rules:
- Can only move forward sequentially
- Cannot skip blocking stages (PAYMENT_PENDING)
- Cannot move backward
```

### **3. With Bypass Enabled**

```
NEW → CONTACTED → FORM_SUBMITTED → APPROVED → ENROLLED
           ↓_______________________________↑
                 (can jump directly)

Rules:
- Can jump to ANY enabled stage
- Blocking stages still apply (must pay before ENROLLED)
- Can move backward (discouraged)
- All bypasses are logged for audit
```

---

## API Usage

### **Update Stage (Without Bypass)**

```bash
PATCH /api/admissions/enquiries/123/update-stage/
{
    "stage": "FORM_SUBMITTED",
    "note": "Application form received"
}

Response:
{
    "data": { ...enquiry... },
    "warning": null
}
```

### **Update Stage (With Bypass)**

```bash
PATCH /api/admissions/enquiries/123/update-stage/
{
    "stage": "ENROLLED",
    "force_bypass": true,
    "note": "Urgent approval granted"
}

Response:
{
    "data": { ...enquiry... },
    "warning": "Bypassing stages: FORM_SUBMITTED → APPROVED → PAYMENT_PENDING"
}
```

---

## Validation Rules

### **Rule 1: Stage Must Be Enabled**
```python
# If stage not in session.enabled_stages
Error: "Stage 'INVALID_STAGE' is not enabled for this session"
```

### **Rule 2: Cannot Bypass From Terminal Stages**
```python
# Terminal stages: ENROLLED, REJECTED, WITHDRAWN, LOST
# Once in terminal state, no transitions allowed
Error: "Cannot transition from terminal stage 'ENROLLED'"
```

### **Rule 3: Sequential Progression (Without Bypass)**
```python
# Without bypass: can only move forward, one stage at a time
# Can skip optional stages
NEW → [CONTACTED (optional)] → FORM_SUBMITTED → ...
```

### **Rule 4: Cannot Skip Blocking Stages (Without Bypass)**
```python
# Blocking stages must be completed
# PAYMENT_PENDING is blocking (must pay before ENROLLED)
Error: "Cannot skip blocking stage 'PAYMENT_PENDING' (bypass not enabled)"
```

### **Rule 5: Fee Requirement for Enrollment**
```python
# When session.require_fee_before_enrollment = True
# Cannot reach ENROLLED without is_fee_paid = True
Error: "Fee must be paid before enrollment"

# Even with bypass, fee is still required
Error: "Fee must be paid before enrollment (even with bypass)"
```

---

## Workflow Service Methods

### **validate_stage_transition(enquiry, new_stage_key, force_bypass=False)**

Validates if transition is allowed:

```python
from admissions.workflow_service import AdmissionWorkflowService

# Normal validation
result = AdmissionWorkflowService.validate_stage_transition(
    enquiry, 'APPROVED'
)
# Returns: {'valid': True, 'error': None, 'warning': None}

# With bypass
result = AdmissionWorkflowService.validate_stage_transition(
    enquiry, 'ENROLLED', force_bypass=True
)
# Returns: {
#     'valid': True,
#     'error': None,
#     'warning': 'Bypassing stages: FORM_SUBMITTED → APPROVED → PAYMENT_PENDING'
# }
```

### **can_bypass_stages(session)**

Check if bypass is allowed:

```python
if AdmissionWorkflowService.can_bypass_stages(session):
    # Show bypass button in UI
    pass
```

### **get_enabled_next_stages(enquiry)**

Get valid next stages for dropdown:

```python
next_stages = AdmissionWorkflowService.get_enabled_next_stages(enquiry)
# Returns: [
#     {'stage_key': 'FORM_SUBMITTED', 'stage_label': 'Form Submitted', 'order': 2},
#     {'stage_key': 'APPROVED', 'stage_label': 'Approved', 'order': 3},
# ]
```

### **get_stage_path(session, from_stage_key, to_stage_key)**

Get stages between two points:

```python
path = AdmissionWorkflowService.get_stage_path(
    session, 'CONTACTED', 'APPROVED'
)
# Returns: ['CONTACTED', 'FORM_SUBMITTED', 'APPROVED']
```

### **get_stage_requirements(session, stage_key)**

Get stage info:

```python
info = AdmissionWorkflowService.get_stage_requirements(session, 'PAYMENT_PENDING')
# Returns: {
#     'stage_key': 'PAYMENT_PENDING',
#     'stage_label': 'Awaiting Payment',
#     'order': 4,
#     'is_optional': False,
#     'is_blocking': True,
#     'description': 'Waiting for admission fee payment'
# }
```

### **get_blocked_stages(session)**

Get all blocking stages:

```python
blocked = AdmissionWorkflowService.get_blocked_stages(session)
# Returns: [<AdmissionStageConfig: Awaiting Payment>, ...]
```

### **get_optional_stages(session)**

Get all optional stages:

```python
optional = AdmissionWorkflowService.get_optional_stages(session)
# Returns: [<AdmissionStageConfig: Contacted>, ...]
```

---

## New API Endpoints

### **1. Get Workflow Information**

```bash
GET /api/admissions/enquiries/123/workflow-info/

Response:
{
    "workflow_type": "STANDARD",
    "allow_stage_bypass": true,
    "current_stage": {
        "stage_key": "CONTACTED",
        "stage_label": "Contacted",
        "order": 1,
        "is_optional": true,
        "is_blocking": false,
        "description": "Parent/guardians contacted (optional)"
    },
    "next_stages": [
        {
            "stage_key": "FORM_SUBMITTED",
            "stage_label": "Form Submitted",
            "order": 2
        },
        {
            "stage_key": "APPROVED",
            "stage_label": "Approved",
            "order": 3
        }
    ],
    "blocked_stages": [
        {
            "stage_key": "PAYMENT_PENDING",
            "stage_label": "Awaiting Payment",
            "order": 4
        }
    ],
    "optional_stages": [
        {
            "stage_key": "CONTACTED",
            "stage_label": "Contacted",
            "order": 1
        }
    ],
    "fee_required_before_enrollment": true,
    "is_fee_paid": false
}
```

### **2. Get Session Workflow Details**

```bash
GET /api/admissions/sessions/5/workflow-details/

Response:
{
    "workflow_type": "STANDARD",
    "allow_stage_bypass": true,
    "require_fee_before_enrollment": true,
    "require_campus_visit": false,
    "require_entrance_test": false,
    "require_parent_interview": false,
    "stages": [
        {
            "stage_key": "NEW",
            "stage_label": "New Enquiry",
            "order": 0,
            "is_optional": false,
            "is_blocking": false,
            "description": "Initial enquiry/application received"
        },
        ...
    ],
    "total_stages": 6,
    "blocking_stages": [
        {
            "stage_key": "PAYMENT_PENDING",
            "stage_label": "Awaiting Payment",
            "order": 4,
            "is_optional": false,
            "is_blocking": true
        }
    ],
    "optional_stages": [
        {
            "stage_key": "CONTACTED",
            "stage_label": "Contacted",
            "order": 1,
            "is_optional": true,
            "is_blocking": false
        }
    ]
}
```

---

## Audit Trail

All bypass actions are automatically logged:

```python
# When bypass is used
AdmissionNote.objects.create(
    enquiry=enquiry,
    user=request.user,
    note="Stage bypassed: FORM_SUBMITTED → APPROVED → PAYMENT_PENDING",
    note_type='SYSTEM',
)
```

View in enquiry activity feed:
- Stage transitions (normal)
- Stage bypasses (marked as SYSTEM notes)
- Who made the change
- When it happened

---

## Use Cases

### **Use Case 1: Urgent Approval**
School needs to quickly admit a high-priority student:

```bash
# Current stage: CONTACTED
# Bypass directly to PAYMENT_PENDING (fee pending)

PATCH /api/admissions/enquiries/123/update-stage/
{
    "stage": "PAYMENT_PENDING",
    "force_bypass": true,
    "note": "VIP admission - urgent approval by principal"
}
```

### **Use Case 2: Data Correction**
Need to move student back to fix an error:

```bash
# (Only if allow_stage_bypass=true)

PATCH /api/admissions/enquiries/123/update-stage/
{
    "stage": "FORM_SUBMITTED",
    "force_bypass": true,
    "note": "Correcting missing documents - moving back for review"
}
```

### **Use Case 3: Skip Optional Step**
Student has already visited, skip VISIT_SCHEDULED:

```bash
# VISIT_SCHEDULED is optional, can skip normally
# No need for bypass

PATCH /api/admissions/enquiries/123/update-stage/
{
    "stage": "FORM_SUBMITTED",  # Skip VISIT_SCHEDULED
    "note": "Student already visited campus last year"
}
```

---

## Best Practices

### **✅ DO:**
- Enable bypass only for workflows that truly need it (COMPLEX template)
- Keep blocking stages (like payment) even with bypass enabled
- Document bypass reasons in notes
- Use for legitimate cases (data fixes, urgent approvals)
- Audit bypass transactions regularly

### **❌ DON'T:**
- Enable bypass for small schools using SIMPLE template
- Bypass fee requirements unnecessarily
- Skip all stages without auditing
- Bypass from terminal stages (system prevents this)
- Use bypass to hide incomplete data

---

## Security Considerations

1. **Permissions**: Only school admin users can use bypass
2. **Audit Trail**: All bypasses are logged with user info
3. **Fee Protection**: Fee requirements can't be bypassed
4. **Terminal Stages**: Cannot transition out of terminal states
5. **Session Control**: Each school controls its own bypass settings

---

## Configuration Examples

### **Example 1: SIMPLE Template (No Bypass)**
```python
AdmissionWorkflowService.initialize_session_with_template(
    session, 'SIMPLE'
)
# Result: allow_stage_bypass = False (no bypass possible)
```

### **Example 2: STANDARD Template (With Bypass)**
```python
session.allow_stage_bypass = True
session.save()

AdmissionWorkflowService.initialize_session_with_template(
    session, 'STANDARD'
)
# Result: Bypass enabled for STANDARD workflow
```

### **Example 3: COMPLEX Template (Full Control)**
```python
session = AdmissionSession.objects.create(
    ...
    workflow_type='COMPLEX',
    allow_stage_bypass=True,  # Full flexibility
    require_fee_before_enrollment=True,  # But strict on fees
)

AdmissionWorkflowService.initialize_session_with_template(
    session, 'COMPLEX'
)
# Result: Full workflow with bypass capability but fee enforcement
```

---

## Troubleshooting

### **Problem: "Cannot bypass - it's disabled for this session"**
- Check: `session.allow_stage_bypass`
- Solution: Set to `True` if needed

### **Problem: "Fee must be paid before enrollment"**
- This is intentional protection
- Solution: Record fee first, then bypass if needed

### **Problem: "Cannot transition from terminal stage"**
- Terminal stages can't have further transitions
- Solution: None - this is a designed constraint

### **Problem: "Bypass stages hidden in UI"**
- Check: `session.allow_stage_bypass`
- Check: User permissions (must be admin)
- Solution: Verify session config and user role

---

## Future Enhancements

- [ ] Role-based bypass permissions (only Principal can bypass)
- [ ] Bypass approval workflow (need manager approval to bypass)
- [ ] Custom bypass rules per stage
- [ ] Bypass analytics dashboard
- [ ] Time-based bypass (can only bypass within X days)

