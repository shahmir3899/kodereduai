# Admissions Process Simplification & Flexibility Plan

**Date**: February 16, 2026  
**Status**: Planning Phase  
**Priority**: High

---

## Executive Summary

Transform the **rigid 13-stage admission process** into a **flexible, configurable system** that:
- Allows schools to choose predefined templates (Simple, Standard, Complex)
- Enables skipping/bypassing optional steps
- Moves fee collection BEFORE student conversion (not after)
- Properly creates StudentEnrollment records
- Maintains data integrity and reporting

---

## Current State Issues

| Issue | Impact | Example |
|-------|--------|---------|
| **All 13 stages mandatory** | Forces complex schools on small schools | Single-room school forced through campus visits + exams |
| **No flow flexibility** | Can't skip optional steps | No way to skip "TEST_DONE" if school doesn't test |
| **Fee after conversion** | Student created before payment confirmed | Student in system but payment pending |
| **Missing StudentEnrollment** | Student not linked to academic year | No class assignment record in enrollments table |
| **No templates** | Each school must configure from scratch | Wasted time for similar institutions |

---

## Proposed Solution

### 1. **Predefined Stage Templates**

#### **Template A: SIMPLE** (Single Window)
```
NEW → APPROVED → ENROLLED
(3 stages, ~1 week decision)
Best for: Small schools, fast admissions
```

**Optional Steps**:
- CONTACTED ✓ (can skip)
- Basic form only

---

#### **Template B: STANDARD** (Most Schools)
```
NEW → CONTACTED → FORM_SUBMITTED → 
APPROVED → PAYMENT_PENDING → ENROLLED
(5 stages, ~2 weeks decision)
Best for: Medium schools, structured process
```

**Optional Steps**:
- VISIT_SCHEDULED ✓ (can skip)
- TEST_SCHEDULED ✓ (can skip)

---

#### **Template C: COMPLEX** (Your Current)
```
NEW → CONTACTED → VISIT_SCHEDULED → VISIT_DONE →
FORM_SUBMITTED → TEST_SCHEDULED → TEST_DONE →
OFFERED → ACCEPTED → PAYMENT_PENDING → ENROLLED
(10 core stages, ~4-6 weeks, fully trackable)
Best for: Large institutions, competitive admissions
```

**Optional Steps**: None (all are critical)

---

### 2. **Database Schema Changes**

#### **A. Extend AdmissionSession Model**

```python
class AdmissionSession(models.Model):
    # ... existing fields ...
    
    # NEW: Configurable workflow
    workflow_type = models.CharField(
        max_length=20,
        choices=[
            ('SIMPLE', 'Simple: Quick Approval'),
            ('STANDARD', 'Standard: Moderate Process'),
            ('COMPLEX', 'Complex: Full Pipeline'),
            ('CUSTOM', 'Custom: School-Defined'),
        ],
        default='STANDARD'
    )
    
    # NEW: Custom stage configuration
    enabled_stages = models.JSONField(
        default=list,
        help_text="Ordered list of enabled stage names for this session",
        # Example: ['NEW', 'CONTACTED', 'FORM_SUBMITTED', 'APPROVED', 'PAYMENT_PENDING', 'ENROLLED']
    )
    
    # NEW: Bypass control
    allow_stage_bypass = models.BooleanField(
        default=False,
        help_text="Allow staff to move enquiries between any stages (skip ahead)"
    )
    
    # NEW: Fee integration
    require_fee_before_enrollment = models.BooleanField(
        default=True,
        help_text="If True, payment must be confirmed before ENROLLED stage"
    )
    
    # NEW: School configuration
    require_campus_visit = models.BooleanField(default=False)
    require_entrance_test = models.BooleanField(default=False)
    require_parent_interview = models.BooleanField(default=False)
```

---

#### **B. New AdmissionStageConfig Model**

```python
class AdmissionStageConfig(models.Model):
    """Define custom stages for a school's admission process."""
    
    session = models.ForeignKey(
        AdmissionSession,
        on_delete=models.CASCADE,
        related_name='stage_configs'
    )
    stage_key = models.CharField(max_length=50)  # e.g., 'NEW', 'APPROVED'
    stage_label = models.CharField(max_length=100)  # e.g., 'New Enquiry'
    order = models.PositiveIntegerField()  # Display/transition order
    is_optional = models.BooleanField(default=False)
    is_blocking = models.BooleanField(
        default=False,
        help_text="If True, can't skip this stage"
    )
    description = models.TextField(blank=True)
    
    class Meta:
        unique_together = ('session', 'stage_key')
        ordering = ['order']
```

---

#### **C. New AdmissionFeeRecord Model**

```python
class AdmissionFeeRecord(models.Model):
    """Track fee collection linked to admission enquiry."""
    
    enquiry = models.OneToOneField(
        AdmissionEnquiry,
        on_delete=models.CASCADE,
        related_name='fee_record'
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    fee_type = models.CharField(
        max_length=20,
        choices=[
            ('REGISTRATION', 'Registration Fee'),
            ('ADMISSION', 'Admission Fee'),
            ('FULL_PAYMENT', 'Full Year Payment'),
        ]
    )
    status = models.CharField(
        max_length=20,
        choices=[
            ('PENDING', 'Pending'),
            ('PARTIAL', 'Partial Payment'),
            ('COMPLETED', 'Payment Received'),
        ],
        default='PENDING'
    )
    payment_date = models.DateTimeField(null=True, blank=True)
    transaction_id = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

---

### 3. **Updated AdmissionEnquiry Model Changes**

```python
class AdmissionEnquiry(models.Model):
    # ... keep all existing fields ...
    
    # NEW: Workflow tracking
    current_stage_config = models.ForeignKey(
        'AdmissionStageConfig',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='enquiries',
        help_text="Reference to enabled stage config (not hardcoded choices)"
    )
    
    # MODIFY stage to accept dynamic values
    stage = models.CharField(
        max_length=50,  # Increased from 20 to accommodate custom stages
        # No hardcoded choices - validated by current_stage_config
    )
    
    # RENAME (for clarity) or ADD alongside
    is_fee_paid = models.BooleanField(
        default=False,
        help_text="Fee collected before enrollment"
    )
```

---

## 4. **Logic Flow Diagrams**

### **Simple Template Flow**
```
CREATE ENQUIRY (NEW)
    ↓ [Staff Reviews]
APPROVE (APPROVED) → Can skip to ENROLLED directly
    ↓ [Fee collected if needed]
PAYMENT_PENDING
    ↓ [Payment confirmed]
ENROLLED [StudentEnrollment created]
```

### **Standard Template Flow**
```
CREATE ENQUIRY (NEW)
    ↓ [Follow-up call]
CONTACTED (Optional - can skip)
    ↓ [Send form]
FORM_SUBMITTED
    ↓ [Basic review, no test/visit]
APPROVED
    ↓ [Payment]
PAYMENT_PENDING
    ↓ [Confirmation]
ENROLLED [StudentEnrollment created]
```

### **Complex Template Flow (Current)**
```
CREATE ENQUIRY (NEW)
    ↓
CONTACTED
    ↓
VISIT_SCHEDULED (Required if allow_stage_bypass=False)
    ↓
VISIT_DONE
    ↓
FORM_SUBMITTED
    ↓
TEST_SCHEDULED (Blocking stage)
    ↓
TEST_DONE
    ↓
OFFERED
    ↓
ACCEPTED/REJECTED
    ↓ [If ACCEPTED]
PAYMENT_PENDING (Blocking - can't skip)
    ↓ [Fee must be paid]
ENROLLED [StudentEnrollment created]
```

---

## 5. **Key Implementation Details**

### **A. Stage Transition Rules**

```python
def validate_stage_transition(enquiry, new_stage):
    """
    Validate if stage transition is allowed.
    
    Rules:
    1. New stage must be in enabled_stages
    2. If allow_stage_bypass=False, stages must be sequential
    3. Blocking stages cannot be skipped
    4. Fee must be confirmed before ENROLLED
    """
    
    session = enquiry.session
    enabled_stages = session.enabled_stages
    
    # Rule 1: Check if stage exists in config
    if new_stage not in enabled_stages:
        raise ValidationError(f"Stage {new_stage} not enabled for this session")
    
    # Rule 2: Sequential validation
    if not session.allow_stage_bypass:
        current_idx = enabled_stages.index(enquiry.stage)
        new_idx = enabled_stages.index(new_stage)
        if new_idx < current_idx:
            raise ValidationError("Cannot move backwards in stage")
        if new_idx > current_idx + 1 and not is_stage_optional(current_idx):
            raise ValidationError("Cannot skip mandatory stage")
    
    # Rule 3: Blocking stages
    if is_blocking_stage(new_stage) and new_idx > current_idx:
        if enquiry.status != 'READY':
            raise ValidationError(f"Stage {new_stage} requires prerequisites")
    
    # Rule 4: Fee before enrollment
    if new_stage == 'ENROLLED' and session.require_fee_before_enrollment:
        if not enquiry.is_fee_paid:
            raise ValidationError("Fee must be collected before enrollment")
```

---

### **B. Convert to Student with StudentEnrollment**

```python
@action(detail=True, methods=['post'], url_path='convert')
def convert(self, request, pk=None):
    """
    Convert ACCEPTED enquiry to Student.
    NOW ALSO CREATES StudentEnrollment record.
    """
    enquiry = self.get_object()
    session = enquiry.session
    
    # Validation
    if enquiry.stage != 'ENROLLED':
        raise ValidationError("Only ENROLLED enquiries can be converted")
    
    if session.require_fee_before_enrollment and not enquiry.is_fee_paid:
        raise ValidationError("Fee must be paid before conversion")
    
    class_id = request.data['class_id']
    roll_number = request.data['roll_number']
    
    with transaction.atomic():
        # Create Student
        student = Student.objects.create(
            school_id=session.school_id,
            class_obj_id=class_id,
            roll_number=roll_number,
            name=enquiry.child_name,
            # ... other fields ...
        )
        
        # ••• NEW •••
        # Create StudentEnrollment linking to academic year
        enrollment = StudentEnrollment.objects.create(
            school_id=session.school_id,
            student=student,
            academic_year=session.academic_year,  # From AdmissionSession
            class_obj_id=class_id,
            roll_number=roll_number,
            status='ACTIVE'
        )
        
        # Mark enquiry as converted
        enquiry.converted_student = student
        enquiry.save()
        
        return Response({
            'student': StudentSerializer(student).data,
            'enrollment': StudentEnrollmentSerializer(enrollment).data,
        })
```

---

### **C. Initialize Session with Template**

```python
# When creating AdmissionSession:
def initialize_session_with_template(session, template_type):
    """
    Pre-populate enabled_stages based on template.
    """
    
    templates = {
        'SIMPLE': [
            ('NEW', 'New Enquiry', 0),
            ('APPROVED', 'Approved', 1),
            ('PAYMENT_PENDING', 'Awaiting Payment', 2),
            ('ENROLLED', 'Final - Enrolled', 3),
        ],
        'STANDARD': [
            ('NEW', 'New Enquiry', 0),
            ('CONTACTED', 'Contacted', 1),
            ('FORM_SUBMITTED', 'Form Submitted', 2),
            ('APPROVED', 'Approved', 3),
            ('PAYMENT_PENDING', 'Awaiting Payment', 4),
            ('ENROLLED', 'Final - Enrolled', 5),
        ],
        'COMPLEX': [
            ('NEW', 'New Enquiry', 0),
            ('CONTACTED', 'Contacted', 1),
            ('VISIT_SCHEDULED', 'Campus Visit Scheduled', 2),
            ('VISIT_DONE', 'Campus Visit Done', 3),
            ('FORM_SUBMITTED', 'Form Submitted', 4),
            ('TEST_SCHEDULED', 'Test Scheduled', 5),
            ('TEST_DONE', 'Test Completed', 6),
            ('OFFERED', 'Offer Made', 7),
            ('ACCEPTED', 'Accepted', 8),
            ('PAYMENT_PENDING', 'Awaiting Payment', 9),
            ('ENROLLED', 'Final - Enrolled', 10),
        ],
    }
    
    stage_list = templates[template_type]
    session.enabled_stages = [s[0] for s in stage_list]
    
    for stage_key, label, order in stage_list:
        AdmissionStageConfig.objects.create(
            session=session,
            stage_key=stage_key,
            stage_label=label,
            order=order,
            is_optional=stage_key in ['CONTACTED', 'VISIT_SCHEDULED', 'TEST_SCHEDULED'],
            is_blocking=stage_key in ['PAYMENT_PENDING', 'ENROLLED'],
        )
    
    session.save()
```

---

## 6. **API Changes**

### **Create Session with Template**
```
POST /api/admissions/sessions/
{
    "name": "Admission 2025-26",
    "school": 1,
    "academic_year": 5,
    "start_date": "2025-10-01",
    "end_date": "2025-12-31",
    "workflow_type": "STANDARD",
    "allow_stage_bypass": false,
    "require_fee_before_enrollment": true,
    "require_campus_visit": false,
    "require_entrance_test": false
}
```

### **Update Enquiry Stage (With Validation)**
```
PATCH /api/admissions/enquiries/123/update-stage/
{
    "stage": "APPROVED"
    // System validates against session.enabled_stages
    // and transition rules
}
```

### **Record Fee Payment**
```
POST /api/admissions/enquiries/123/record-fee/
{
    "amount": 5000,
    "fee_type": "REGISTRATION",
    "transaction_id": "TXN123456"
}
```

### **Convert to Student (Updated)**
```
POST /api/admissions/enquiries/123/convert/
{
    "class_id": 5,
    "roll_number": "A101"
    // NOW creates StudentEnrollment automatically
}
```

---

## 7. **Migration Strategy**

### **Phase 1: Database Setup (Week 1)**
- [ ] Create AdmissionStageConfig model
- [ ] Create AdmissionFeeRecord model
- [ ] Extend AdmissionSession with new fields
- [ ] Modify AdmissionEnquiry stage field
- [ ] Create migration

### **Phase 2: Backend Logic (Week 2)**
- [ ] Implement stage transition validation
- [ ] Add template initialization logic
- [ ] Fix convert() to create StudentEnrollment
- [ ] Add fee collection workflow
- [ ] Update serializers

### **Phase 3: API & Views (Week 2-3)**
- [ ] Update AdmissionSessionViewSet to handle templates
- [ ] Update AdmissionEnquiryViewSet stage transitions
- [ ] Add fee recording endpoints
- [ ] Update convert endpoint
- [ ] Add validation error messages

### **Phase 4: Frontend Integration (Week 3-4)**
- [ ] Show enabled stages only in UI
- [ ] Implement bypass controls (if allowed)
- [ ] Add fee payment form
- [ ] Update analytics for configurable stages
- [ ] Update dashboard

### **Phase 5: Testing & Documentation (Week 4)**
- [ ] Unit tests for stage transitions
- [ ] Integration tests for all 3 templates
- [ ] Test fee workflows
- [ ] Test StudentEnrollment creation
- [ ] Update API documentation

### **Phase 6: Data Migration (Week 5)**
- [ ] Backfill templates for existing sessions
- [ ] Assign stage configs to old enquiries
- [ ] Create StudentEnrollment for already-admitted students
- [ ] Verify data integrity

---

## 8. **Backward Compatibility**

**Existing Admissions Sessions** (using 13-stage model):
```python
# Auto-detect and assign 'COMPLEX' template
if AdmissionSession.workflow_type is None:
    session.workflow_type = 'COMPLEX'
    session.enabled_stages = [all 13 original stages]
    session.allow_stage_bypass = False
    session.save()
```

---

## 9. **Benefits**

| Benefit | Impact |
|---------|--------|
| **Flexibility** | Each school chooses complexity level |
| **Simplicity** | Small schools not burdened by complex steps |
| **Fee Control** | Payment collected BEFORE enrollment |
| **Data Integrity** | StudentEnrollment always created |
| **Configurability** | Custom stages if needed |
| **Reporting** | Can track any workflow type |
| **Future-Proof** | Easy to add more templates |

---

## 10. **Implementation Checklist**

### Models
- [ ] Create AdmissionStageConfig model
- [ ] Create AdmissionFeeRecord model
- [ ] Update AdmissionSession model fields
- [ ] Update AdmissionEnquiry stage field

### Views
- [ ] Update AdmissionSessionViewSet
- [ ] Update AdmissionEnquiryViewSet
- [ ] Add stage transition validation
- [ ] Fix convert() method

### Serializers
- [ ] Update AdmissionSessionSerializer
- [ ] Create AdmissionStageConfigSerializer
- [ ] Create AdmissionFeeRecordSerializer
- [ ] Update AdmissionEnquiryDetailSerializer

### Migrations
- [ ] Create initial migration
- [ ] Create data migration for templates

### Tests
- [ ] Test SIMPLE template flow
- [ ] Test STANDARD template flow
- [ ] Test COMPLEX template flow
- [ ] Test stage bypass logic
- [ ] Test fee workflows
- [ ] Test StudentEnrollment creation
- [ ] Test backward compatibility

### Documentation
- [ ] Update API documentation
- [ ] Create user guide for school admin
- [ ] Add code comments

---

## Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| Planning & Design Review | 1-2 days | Product |
| Database Schema | 3-5 days | Backend |
| Core Logic Implementation | 7-10 days | Backend |
| API & View Updates | 5-7 days | Backend |
| Frontend Integration | 7-10 days | Frontend |
| Testing & Refinement | 5-7 days | QA + Backend |
| Deployment & Migration | 2-3 days | DevOps |
| **Total** | **~30-35 days** | |

---

## Questions to Clarify

1. **Should custom stages be allowed at runtime?** Or are the 3 templates sufficient?
2. **Should bypass be per-user role?** (e.g., Principal can bypass, staff cannot)
3. **Fee payment method integration?** (Rafiki, M-Pesa, Bank transfer, Cash?)
4. **Should old 13-stage sessions auto-migrate to COMPLEX?** Or create manually?
5. **Do you need stage-specific form fields?** (e.g., TEST_DONE requires test score)

---

## Dependencies

- Django ORM (existing)
- DRF (existing)
- Students app (for StudentEnrollment)
- Finance module (for fee integration - future)

