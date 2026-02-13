# Phase 3: Customer-Facing & Revenue

## Overview

**Goal:** Close the largest revenue-impacting gaps by building customer-facing interfaces and enabling online payments.

**Expected Impact:** Overall mind map coverage from **43% → ~58%**

| Priority | Module | Current Coverage | Target Coverage |
|----------|--------|-----------------|-----------------|
| P1 | Parent Portal | 0% | ~70% |
| P2 | Payment Gateway | 0% | ~80% |
| P3 | Discount & Scholarship | 0% | ~90% |
| P4 | Admission CRM | 0% | ~40% (basic) |

**Pillar Impact:**
- Parent Interface: 0% → ~70% (biggest jump)
- Finance & Operations: 70% → ~85%
- Growth & Marketing: 10% → ~25%

---

## Priority 1: Parent Portal

**Why first:** The #1 remaining customer-facing gap (0% coverage). Parents are the paying customers — giving them visibility into their child's school life drives satisfaction, retention, and fee collection.

### 1.1 New Django App: `parents`

```
backend/parents/
├── __init__.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── admin.py
├── apps.py
└── migrations/
```

### 1.2 Models

#### ParentProfile

```python
class ParentProfile(models.Model):
    """
    Links a User account to their parent identity.
    A parent can have children across multiple schools.
    """
    user = models.OneToOneField('users.User', on_delete=models.CASCADE, related_name='parent_profile')
    phone = models.CharField(max_length=20)
    alternate_phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    occupation = models.CharField(max_length=100, blank=True)
    relation_to_default = models.CharField(max_length=20, choices=[
        ('FATHER', 'Father'), ('MOTHER', 'Mother'),
        ('GUARDIAN', 'Guardian'), ('OTHER', 'Other')
    ], default='FATHER')
    profile_photo_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['phone'])]
```

#### ParentChild

```python
class ParentChild(models.Model):
    """
    Many-to-many link between parent and students (supports siblings).
    One parent can have multiple children; one child can have multiple parents.
    """
    parent = models.ForeignKey(ParentProfile, on_delete=models.CASCADE, related_name='children')
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE, related_name='parents')
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    relation = models.CharField(max_length=20, choices=[
        ('FATHER', 'Father'), ('MOTHER', 'Mother'),
        ('GUARDIAN', 'Guardian'), ('OTHER', 'Other')
    ])
    is_primary = models.BooleanField(default=False)  # Primary contact for this child
    can_pickup = models.BooleanField(default=True)    # Authorized for pickup
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('parent', 'student')
        indexes = [
            models.Index(fields=['school', 'parent']),
            models.Index(fields=['student']),
        ]
```

#### ParentLeaveRequest

```python
class ParentLeaveRequest(models.Model):
    """Parent applies for child's leave from school."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    parent = models.ForeignKey(ParentProfile, on_delete=models.CASCADE, related_name='leave_requests')
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE)
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField()
    document_url = models.URLField(blank=True)  # Supporting document (medical cert, etc.)
    status = models.CharField(max_length=20, choices=[
        ('PENDING', 'Pending'), ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'), ('CANCELLED', 'Cancelled')
    ], default='PENDING')
    reviewed_by = models.ForeignKey('users.User', null=True, blank=True, on_delete=models.SET_NULL)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['student', 'start_date']),
        ]
```

#### ParentMessage

```python
class ParentMessage(models.Model):
    """
    Simple messaging between parent and teacher/admin.
    Thread-based: messages share a thread_id.
    """
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    thread_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    sender_user = models.ForeignKey('users.User', on_delete=models.CASCADE, related_name='sent_parent_messages')
    recipient_user = models.ForeignKey('users.User', on_delete=models.CASCADE, related_name='received_parent_messages')
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE)  # Context: which child
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['thread_id', 'created_at']),
            models.Index(fields=['recipient_user', 'is_read']),
            models.Index(fields=['school', 'student']),
        ]
        ordering = ['created_at']
```

### 1.3 User Role Addition

Add `PARENT` role to the system:

```python
# In users/models.py or schools/models.py (UserSchoolMembership)
# Add to ROLE_CHOICES:
('PARENT', 'Parent')
```

Update `core/permissions.py`:
```python
PARENT_ROLES = ('PARENT',)

class IsParent(permissions.BasePermission):
    """Allow only parent users."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        membership = getattr(request, 'school_membership', None)
        return membership and membership.role == 'PARENT'

class IsParentOrAdmin(permissions.BasePermission):
    """Allow parents (own data) or admins (all data)."""
    ...
```

### 1.4 API Endpoints

```
POST   /api/parents/register/              # Parent self-registration with invite code
GET    /api/parents/my-children/            # List linked children
GET    /api/parents/children/{id}/overview/ # Child dashboard (attendance, fees, grades)

GET    /api/parents/children/{id}/attendance/        # Attendance calendar for child
GET    /api/parents/children/{id}/attendance/summary/ # Monthly attendance summary

GET    /api/parents/children/{id}/fees/              # Fee status & payment history
GET    /api/parents/children/{id}/fees/outstanding/  # Outstanding dues

GET    /api/parents/children/{id}/timetable/         # Child's weekly timetable
GET    /api/parents/children/{id}/exam-results/      # Exam results & report cards

POST   /api/parents/leave-requests/                  # Apply for child's leave
GET    /api/parents/leave-requests/                  # List leave requests
PATCH  /api/parents/leave-requests/{id}/cancel/      # Cancel pending request

# Admin endpoints for managing leave requests
GET    /api/parents/admin/leave-requests/             # List all leave requests
PATCH  /api/parents/admin/leave-requests/{id}/review/ # Approve/reject

# Messaging
GET    /api/parents/messages/threads/                # List message threads
GET    /api/parents/messages/threads/{thread_id}/    # Get thread messages
POST   /api/parents/messages/                        # Send message
PATCH  /api/parents/messages/{id}/read/              # Mark as read

# Admin: parent management
GET    /api/parents/admin/parents/                   # List all parents
POST   /api/parents/admin/link-child/                # Link parent to student
DELETE /api/parents/admin/unlink-child/{id}/          # Unlink parent from student
POST   /api/parents/admin/generate-invite/           # Generate invite code for parent
```

### 1.5 Parent Registration Flow

```
1. Admin creates invite → generates unique code (linked to student + school)
2. Parent opens registration link with invite code
3. Parent creates account (name, email, phone, password)
4. System auto-links parent to student(s) via invite
5. Parent logs in → sees parent dashboard with children
```

Model for invite:

```python
class ParentInvite(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE)
    invite_code = models.CharField(max_length=20, unique=True)
    relation = models.CharField(max_length=20)
    parent_phone = models.CharField(max_length=20)  # Expected phone for verification
    is_used = models.BooleanField(default=False)
    used_by = models.ForeignKey(ParentProfile, null=True, blank=True, on_delete=models.SET_NULL)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
```

### 1.6 Frontend Pages

#### Parent-Specific Pages (new route group)

```
frontend/src/pages/parent/
├── ParentDashboard.jsx          # Overview of all children
├── ChildOverview.jsx            # Single child dashboard
├── ChildAttendance.jsx          # Attendance calendar (green/red/gray)
├── ChildFees.jsx                # Fee status, payment history, pay button
├── ChildTimetable.jsx           # Weekly timetable view
├── ChildExamResults.jsx         # Exam results with grade display
├── LeaveApplication.jsx         # Apply for leave + list requests
├── ParentMessages.jsx           # Message threads with teachers
└── ParentProfile.jsx            # Edit parent profile
```

#### Routes (in App.jsx)

```jsx
{/* Parent Routes */}
<Route path="/parent" element={<ParentRoute><Layout variant="parent" /></ParentRoute>}>
  <Route index element={<Navigate to="dashboard" />} />
  <Route path="dashboard" element={<ParentDashboard />} />
  <Route path="children/:studentId" element={<ChildOverview />} />
  <Route path="children/:studentId/attendance" element={<ChildAttendance />} />
  <Route path="children/:studentId/fees" element={<ChildFees />} />
  <Route path="children/:studentId/timetable" element={<ChildTimetable />} />
  <Route path="children/:studentId/results" element={<ChildExamResults />} />
  <Route path="leave" element={<LeaveApplication />} />
  <Route path="messages" element={<ParentMessages />} />
  <Route path="profile" element={<ParentProfile />} />
</Route>
```

#### Parent Dashboard Widgets

```
┌─────────────────────────────────────────────────┐
│  Welcome, Mr. Ahmed                              │
│  Parent of: Ali (Grade 5-A), Sara (Grade 3-B)   │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌─ Ali (Grade 5-A) ──────────────────────────┐  │
│  │ Attendance: 91% ✓   Fees: PKR 5,000 due ⚠  │  │
│  │ Last Exam: 78% (B+)  Next: Mid-Term Mar 15 │  │
│  │ [View Details]                               │  │
│  └──────────────────────────────────────────────┘  │
│                                                   │
│  ┌─ Sara (Grade 3-B) ──────────────────────────┐  │
│  │ Attendance: 95% ✓   Fees: Paid ✓            │  │
│  │ Last Exam: 85% (A)   Next: Mid-Term Mar 15  │  │
│  │ [View Details]                               │  │
│  └──────────────────────────────────────────────┘  │
│                                                   │
│  Recent Notifications (3)                         │
│  • Fee reminder: Ali's March fee is due           │
│  • Sara scored 92% in Science quiz                │
│  • School closed on Mar 23 (Pakistan Day)         │
│                                                   │
└─────────────────────────────────────────────────┘
```

#### Attendance Calendar (ChildAttendance.jsx)

```
Monthly calendar grid showing:
- Green dot = Present
- Red dot = Absent
- Yellow dot = Late
- Gray dot = Holiday/Weekend
- Summary bar: Present: 22 | Absent: 2 | Late: 1 | Rate: 91.6%
- Month navigation (prev/next)
```

### 1.7 Module Registration

```python
# In core/module_registry.py
'parents': {
    'key': 'parents',
    'label': 'Parent Portal',
    'description': 'Parent access to child info, fees, attendance, messaging',
    'icon': 'users',
    'dependencies': ['students'],
}
```

### 1.8 Notification Integration

Trigger notifications to parents automatically:
- Absence notification → already exists (`trigger_absence_notification`)
- Fee reminder → already exists (`trigger_fee_reminder`)
- Exam result published → already exists (`trigger_exam_result`)
- Leave request status change → **new trigger**
- New message received → **new trigger**

---

## Priority 2: Payment Gateway Integration

**Why:** Enables online fee collection. Combined with Parent Portal, parents can see dues and pay instantly. Directly impacts school revenue.

### 2.1 Approach: Stripe + Razorpay (configurable per school)

Support multiple gateways with an abstraction layer (same pattern as notification channels).

### 2.2 Models (in `finance` app — no new app needed)

#### PaymentGatewayConfig

```python
class PaymentGatewayConfig(models.Model):
    """Per-school payment gateway configuration."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='payment_gateways')
    gateway = models.CharField(max_length=20, choices=[
        ('STRIPE', 'Stripe'),
        ('RAZORPAY', 'Razorpay'),
        ('JAZZCASH', 'JazzCash'),
        ('EASYPAISA', 'Easypaisa'),
        ('MANUAL', 'Manual/Offline'),
    ])
    is_active = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    # Encrypted credentials (store as env vars or use django-encrypted-fields)
    config = models.JSONField(default=dict, help_text='Gateway-specific config: api_key, secret, webhook_secret')
    currency = models.CharField(max_length=3, default='PKR')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'gateway')
```

#### OnlinePayment

```python
class OnlinePayment(models.Model):
    """Tracks individual online payment transactions."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    fee_payment = models.ForeignKey(FeePayment, on_delete=models.CASCADE, related_name='online_payments')
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE)
    gateway = models.CharField(max_length=20)

    # Transaction details
    gateway_order_id = models.CharField(max_length=100, unique=True)  # Our order ID sent to gateway
    gateway_payment_id = models.CharField(max_length=100, blank=True)  # Gateway's payment ID
    gateway_signature = models.CharField(max_length=255, blank=True)   # For verification

    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='PKR')
    status = models.CharField(max_length=20, choices=[
        ('INITIATED', 'Initiated'),
        ('PENDING', 'Pending'),
        ('SUCCESS', 'Success'),
        ('FAILED', 'Failed'),
        ('REFUNDED', 'Refunded'),
        ('EXPIRED', 'Expired'),
    ], default='INITIATED')

    # Metadata
    gateway_response = models.JSONField(default=dict)  # Full response for audit
    initiated_by = models.ForeignKey('users.User', null=True, on_delete=models.SET_NULL)
    initiated_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['gateway_order_id']),
            models.Index(fields=['student', 'status']),
        ]
```

### 2.3 Payment Gateway Abstraction

```python
# backend/finance/payment_gateways/
├── __init__.py
├── base.py          # BasePaymentGateway abstract class
├── stripe_gw.py     # Stripe implementation
├── razorpay_gw.py   # Razorpay implementation
├── jazzcash_gw.py   # JazzCash implementation
└── factory.py       # get_gateway(school) → returns configured gateway
```

```python
# base.py
class BasePaymentGateway(ABC):
    @abstractmethod
    def create_order(self, amount, currency, metadata) -> dict:
        """Returns: {order_id, gateway_order_id, checkout_url, client_secret}"""

    @abstractmethod
    def verify_payment(self, payment_id, order_id, signature) -> dict:
        """Returns: {verified: bool, payment_id, status, amount}"""

    @abstractmethod
    def process_webhook(self, payload, headers) -> dict:
        """Returns: {event_type, order_id, status, data}"""

    @abstractmethod
    def initiate_refund(self, payment_id, amount) -> dict:
        """Returns: {refund_id, status, amount}"""
```

### 2.4 API Endpoints

```
# Parent/student-facing
POST   /api/finance/payments/initiate/         # Create payment order
POST   /api/finance/payments/verify/           # Verify after redirect
GET    /api/finance/payments/{id}/status/       # Check payment status

# Webhook (no auth — verified by signature)
POST   /api/finance/webhooks/stripe/           # Stripe webhook
POST   /api/finance/webhooks/razorpay/         # Razorpay webhook
POST   /api/finance/webhooks/jazzcash/         # JazzCash webhook

# Admin
GET    /api/finance/online-payments/            # List all online payments
GET    /api/finance/online-payments/reconcile/  # Reconciliation report
POST   /api/finance/online-payments/{id}/refund/ # Initiate refund

# Gateway config (super admin / school admin)
GET    /api/finance/gateway-config/             # List configured gateways
POST   /api/finance/gateway-config/             # Add gateway
PATCH  /api/finance/gateway-config/{id}/        # Update gateway config
```

### 2.5 Payment Flow

```
1. Parent views outstanding fees in Parent Portal
2. Clicks "Pay Now" → selects fees to pay
3. Frontend calls POST /payments/initiate/ with fee_payment_id + amount
4. Backend creates OnlinePayment (INITIATED), calls gateway.create_order()
5. Frontend redirects to gateway checkout / opens inline widget
6. On success → gateway redirects to callback URL
7. Frontend calls POST /payments/verify/ with gateway response
8. Backend verifies signature, updates OnlinePayment (SUCCESS)
9. Backend auto-updates FeePayment status (PAID/PARTIAL)
10. Notification sent to parent (receipt) + admin (collection alert)

Webhook backup: If verify fails or user closes browser,
webhook catches the event and reconciles.
```

### 2.6 Frontend Pages

```
frontend/src/pages/finance/
├── PaymentGatewayConfig.jsx    # Admin: configure gateways
├── OnlinePaymentsPage.jsx      # Admin: view all online payments
└── PaymentReconciliation.jsx   # Admin: reconcile online vs offline

frontend/src/pages/parent/
└── ChildFees.jsx               # Already planned — add "Pay Now" button
```

### 2.7 Receipt Generation

On successful payment:
- Auto-generate PDF receipt (extend existing report engine)
- Include: school logo, student name, amount, date, transaction ID, payment method
- Store URL in OnlinePayment.gateway_response
- Send receipt via WhatsApp/email to parent

---

## Priority 3: Discount & Scholarship Management

**Why:** Common requirement for every school. Enables sibling discounts, early-bird offers, merit scholarships. Directly affects fee calculation accuracy.

### 3.1 Models (in `finance` app)

#### Discount

```python
class Discount(models.Model):
    """Defines a discount rule that can be applied to fee structures."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='discounts')
    academic_year = models.ForeignKey('academic_sessions.AcademicYear', on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=100)  # e.g., "Sibling Discount", "Early Bird"
    discount_type = models.CharField(max_length=20, choices=[
        ('PERCENTAGE', 'Percentage'),
        ('FIXED', 'Fixed Amount'),
    ])
    value = models.DecimalField(max_digits=10, decimal_places=2)  # 10 (%) or 500 (PKR)
    applies_to = models.CharField(max_length=20, choices=[
        ('ALL', 'All Students'),
        ('GRADE', 'Specific Grade'),
        ('CLASS', 'Specific Class'),
        ('STUDENT', 'Individual Student'),
        ('SIBLING', 'Siblings (auto-detect)'),
    ])
    # Optional targeting
    target_grade = models.ForeignKey('students.Grade', null=True, blank=True, on_delete=models.SET_NULL)
    target_class = models.ForeignKey('students.Class', null=True, blank=True, on_delete=models.SET_NULL)

    # Validity
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)    # e.g., early-bird deadline
    is_active = models.BooleanField(default=True)

    # Rules
    max_uses = models.IntegerField(null=True, blank=True)  # Total uses allowed
    stackable = models.BooleanField(default=False)          # Can combine with other discounts?

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['school', 'is_active'])]
```

#### Scholarship

```python
class Scholarship(models.Model):
    """Named scholarship programs with eligibility criteria."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='scholarships')
    academic_year = models.ForeignKey('academic_sessions.AcademicYear', on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=100)  # e.g., "Merit Scholarship", "Need-Based Aid"
    description = models.TextField(blank=True)
    scholarship_type = models.CharField(max_length=20, choices=[
        ('MERIT', 'Merit-Based'),
        ('NEED', 'Need-Based'),
        ('SPORTS', 'Sports'),
        ('STAFF_CHILD', 'Staff Child'),
        ('OTHER', 'Other'),
    ])
    coverage = models.CharField(max_length=20, choices=[
        ('FULL', 'Full Fee Waiver'),
        ('PERCENTAGE', 'Percentage Off'),
        ('FIXED', 'Fixed Amount Off'),
    ])
    value = models.DecimalField(max_digits=10, decimal_places=2)  # 100 (%) or 5000 (PKR)
    max_recipients = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

#### StudentDiscount

```python
class StudentDiscount(models.Model):
    """Tracks which discounts/scholarships are applied to which students."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE, related_name='student_discounts')
    discount = models.ForeignKey(Discount, null=True, blank=True, on_delete=models.CASCADE)
    scholarship = models.ForeignKey(Scholarship, null=True, blank=True, on_delete=models.CASCADE)
    academic_year = models.ForeignKey('academic_sessions.AcademicYear', on_delete=models.CASCADE)
    approved_by = models.ForeignKey('users.User', null=True, on_delete=models.SET_NULL)
    approved_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['school', 'student', 'academic_year'])]
```

### 3.2 Fee Calculation Enhancement

Update the existing `resolve_fee_amount` logic in finance to:

```python
def resolve_fee_amount(student, month, year, academic_year):
    """
    1. Get base fee from FeeStructure (student-level or class-level)
    2. Find active StudentDiscounts for this student + academic_year
    3. Apply discounts in order (fixed first, then percentage)
    4. If sibling discount: auto-detect siblings in same school
    5. Return: base_amount, discount_amount, final_amount, applied_discounts[]
    """
```

### 3.3 API Endpoints

```
# Discounts
GET    /api/finance/discounts/                 # List discounts
POST   /api/finance/discounts/                 # Create discount
PATCH  /api/finance/discounts/{id}/            # Update
DELETE /api/finance/discounts/{id}/            # Delete

# Scholarships
GET    /api/finance/scholarships/              # List scholarships
POST   /api/finance/scholarships/              # Create scholarship
PATCH  /api/finance/scholarships/{id}/         # Update
DELETE /api/finance/scholarships/{id}/         # Delete

# Student assignments
GET    /api/finance/student-discounts/                      # List all assignments
POST   /api/finance/student-discounts/                      # Assign discount/scholarship to student
POST   /api/finance/student-discounts/bulk-assign/          # Bulk assign (e.g., all siblings)
DELETE /api/finance/student-discounts/{id}/                  # Remove assignment
GET    /api/finance/students/{id}/fee-breakdown/             # Fee with discount breakdown

# Sibling auto-detection
GET    /api/finance/siblings/{student_id}/                   # Find siblings by guardian_phone
```

### 3.4 Frontend Pages

```
frontend/src/pages/finance/
├── DiscountsPage.jsx          # CRUD for discounts
├── ScholarshipsPage.jsx       # CRUD for scholarships
└── StudentDiscountsPage.jsx   # Assign discounts to students, bulk assign

# Enhanced existing pages:
# FeeCollectionPage.jsx → show discount breakdown column
# StudentProfilePage.jsx → show active discounts/scholarships in fees tab
```

### 3.5 Sibling Auto-Detection Logic

```python
def find_siblings(student, school):
    """
    Find siblings by matching:
    1. Same guardian_phone (most reliable)
    2. Same parent_phone
    3. Same ParentProfile (if parent portal is active)
    Returns list of Student objects.
    """
```

---

## Priority 4: Admission CRM (Basic)

**Why:** Drives revenue growth by streamlining the admission pipeline. Even a basic version provides structure to what schools currently do manually.

### 4.1 New Django App: `admissions`

```
backend/admissions/
├── __init__.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── admin.py
├── apps.py
└── migrations/
```

### 4.2 Models

#### AdmissionSession

```python
class AdmissionSession(models.Model):
    """Defines an admission window for a specific academic year."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    academic_year = models.ForeignKey('academic_sessions.AcademicYear', on_delete=models.CASCADE)
    name = models.CharField(max_length=100)  # e.g., "2026-27 Admissions"
    start_date = models.DateField()
    end_date = models.DateField()
    grades_open = models.ManyToManyField('students.Grade', blank=True)  # Which grades accepting
    is_active = models.BooleanField(default=True)
    form_fields = models.JSONField(default=dict)  # Customizable form fields
    created_at = models.DateTimeField(auto_now_add=True)
```

#### AdmissionEnquiry

```python
class AdmissionEnquiry(models.Model):
    """Initial enquiry/lead from a prospective parent."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    session = models.ForeignKey(AdmissionSession, on_delete=models.CASCADE, null=True, blank=True)

    # Child info
    child_name = models.CharField(max_length=100)
    child_dob = models.DateField(null=True, blank=True)
    child_gender = models.CharField(max_length=10, blank=True)
    applying_for_grade = models.ForeignKey('students.Grade', on_delete=models.SET_NULL, null=True)
    previous_school = models.CharField(max_length=200, blank=True)

    # Parent info
    parent_name = models.CharField(max_length=100)
    parent_phone = models.CharField(max_length=20)
    parent_email = models.EmailField(blank=True)
    parent_occupation = models.CharField(max_length=100, blank=True)
    address = models.TextField(blank=True)

    # Lead tracking
    source = models.CharField(max_length=30, choices=[
        ('WALK_IN', 'Walk-in'), ('PHONE', 'Phone Call'),
        ('WEBSITE', 'Website'), ('WHATSAPP', 'WhatsApp'),
        ('REFERRAL', 'Referral'), ('SOCIAL_MEDIA', 'Social Media'),
        ('AD_CAMPAIGN', 'Ad Campaign'), ('OTHER', 'Other'),
    ], default='WALK_IN')
    referral_details = models.CharField(max_length=200, blank=True)

    # Pipeline stage
    stage = models.CharField(max_length=20, choices=[
        ('NEW', 'New Enquiry'),
        ('CONTACTED', 'Contacted'),
        ('VISIT_SCHEDULED', 'Campus Visit Scheduled'),
        ('VISIT_DONE', 'Campus Visit Done'),
        ('FORM_SUBMITTED', 'Application Submitted'),
        ('TEST_SCHEDULED', 'Test Scheduled'),
        ('TEST_DONE', 'Test Completed'),
        ('OFFERED', 'Offer Made'),
        ('ACCEPTED', 'Accepted'),
        ('ENROLLED', 'Enrolled'),
        ('REJECTED', 'Rejected'),
        ('WITHDRAWN', 'Withdrawn'),
        ('LOST', 'Lost'),
    ], default='NEW')

    # Interaction tracking
    assigned_to = models.ForeignKey('users.User', null=True, blank=True, on_delete=models.SET_NULL)
    priority = models.CharField(max_length=10, choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High')
    ], default='MEDIUM')
    next_followup_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(default=dict)  # Custom form field responses

    # Conversion
    converted_student = models.ForeignKey('students.Student', null=True, blank=True, on_delete=models.SET_NULL)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['school', 'stage']),
            models.Index(fields=['school', 'next_followup_date']),
            models.Index(fields=['parent_phone']),
        ]
```

#### AdmissionDocument

```python
class AdmissionDocument(models.Model):
    """Documents uploaded during admission process."""
    enquiry = models.ForeignKey(AdmissionEnquiry, on_delete=models.CASCADE, related_name='documents')
    document_type = models.CharField(max_length=30, choices=[
        ('PHOTO', 'Passport Photo'), ('BIRTH_CERT', 'Birth Certificate'),
        ('PREV_REPORT', 'Previous Report Card'), ('TC', 'Transfer Certificate'),
        ('MEDICAL', 'Medical Certificate'), ('ID_PROOF', 'Parent ID Proof'),
        ('ADDRESS_PROOF', 'Address Proof'), ('OTHER', 'Other'),
    ])
    file_url = models.URLField()
    file_name = models.CharField(max_length=200)
    uploaded_at = models.DateTimeField(auto_now_add=True)
```

#### AdmissionNote

```python
class AdmissionNote(models.Model):
    """Activity log / notes on an enquiry."""
    enquiry = models.ForeignKey(AdmissionEnquiry, on_delete=models.CASCADE, related_name='activity_notes')
    user = models.ForeignKey('users.User', on_delete=models.CASCADE)
    note = models.TextField()
    note_type = models.CharField(max_length=20, choices=[
        ('NOTE', 'Note'), ('CALL', 'Phone Call'),
        ('VISIT', 'Campus Visit'), ('EMAIL', 'Email Sent'),
        ('STATUS_CHANGE', 'Status Change'), ('SYSTEM', 'System'),
    ], default='NOTE')
    created_at = models.DateTimeField(auto_now_add=True)
```

### 4.3 API Endpoints

```
# Admission sessions
GET    /api/admissions/sessions/                    # List sessions
POST   /api/admissions/sessions/                    # Create session
PATCH  /api/admissions/sessions/{id}/               # Update

# Enquiries (the core CRM)
GET    /api/admissions/enquiries/                   # List with filters (stage, grade, date)
POST   /api/admissions/enquiries/                   # Create enquiry
GET    /api/admissions/enquiries/{id}/              # Detail view
PATCH  /api/admissions/enquiries/{id}/              # Update fields
PATCH  /api/admissions/enquiries/{id}/stage/        # Move to next stage
POST   /api/admissions/enquiries/{id}/convert/      # Convert to Student (enrolled)

# Documents
POST   /api/admissions/enquiries/{id}/documents/    # Upload document
DELETE /api/admissions/documents/{id}/              # Remove document

# Notes / Activity log
GET    /api/admissions/enquiries/{id}/notes/        # Activity feed
POST   /api/admissions/enquiries/{id}/notes/        # Add note

# Analytics
GET    /api/admissions/analytics/pipeline/          # Pipeline funnel stats
GET    /api/admissions/analytics/sources/            # Lead source breakdown
GET    /api/admissions/analytics/conversion/         # Conversion rate by grade

# Followup tasks
GET    /api/admissions/followups/today/              # Today's followups
GET    /api/admissions/followups/overdue/             # Overdue followups
```

### 4.4 Enquiry → Student Conversion

When an enquiry reaches "ENROLLED" stage:

```python
def convert_to_student(enquiry):
    """
    1. Create Student record from enquiry data
    2. Create StudentEnrollment for academic year
    3. Set enquiry.converted_student = new student
    4. Set enquiry.stage = 'ENROLLED'
    5. Create FeePayment records based on fee structure
    6. Generate ParentInvite for parent portal access
    7. Send welcome notification (WhatsApp + email)
    """
```

### 4.5 Frontend Pages

```
frontend/src/pages/admissions/
├── AdmissionDashboard.jsx      # Pipeline funnel, source breakdown, stats
├── EnquiriesPage.jsx           # List view with filters + kanban toggle
├── EnquiryDetail.jsx           # Full enquiry view with activity timeline
├── EnquiryForm.jsx             # Add/edit enquiry form
├── AdmissionSessionsPage.jsx   # Manage admission windows
└── AdmissionAnalytics.jsx      # Conversion analytics, source tracking
```

#### Pipeline View (Kanban)

```
┌─────────┬───────────┬──────────────┬──────────────┬─────────┐
│   NEW   │ CONTACTED │ VISIT DONE   │ TEST DONE    │ OFFERED │
│  (12)   │   (8)     │    (5)       │    (3)       │   (2)   │
├─────────┼───────────┼──────────────┼──────────────┼─────────┤
│ Ayesha  │ Bilal     │ Fahad        │ Hassan       │ Kamran  │
│ Grade 1 │ Grade 3   │ Grade 5      │ Grade 1      │ Grade 6 │
│ Walk-in │ Website   │ Referral     │ WhatsApp     │ Phone   │
│ Today   │ 2d ago    │ 5d ago       │ 1 week ago   │ 3d ago  │
│         │           │              │              │         │
│ Ahmed   │ Dania     │ Gulzar       │ Imran        │ Laiba   │
│ Grade 2 │ Grade 1   │ Grade 4      │ Grade 7      │ Grade 3 │
│ Phone   │ Social    │ Walk-in      │ Referral     │ Website │
│ Today   │ 1d ago    │ 3d ago       │ 4d ago       │ 1d ago  │
└─────────┴───────────┴──────────────┴──────────────┴─────────┘
```

### 4.6 Module Registration

```python
'admissions': {
    'key': 'admissions',
    'label': 'Admission CRM',
    'description': 'Lead tracking, admission pipeline, enquiry management',
    'icon': 'user-plus',
    'dependencies': ['students'],
}
```

---

## Stretch Goals (if capacity allows)

### S1: Drag-and-Drop Timetable
- Use `@dnd-kit/core` or `react-beautiful-dnd`
- Enhance existing TimetablePage.jsx with drag-drop slots
- Auto-detect teacher conflicts on drop

### S2: Hall Ticket Generation
- Extend report engine with hall ticket template
- Include: student photo, exam schedule, seat number, barcode
- Bulk generate as PDF (one per student)

### S3: Library Management (Basic)
- Book CRUD, barcode scanning, borrow/return workflow
- Overdue tracking with fine calculation
- Student borrowing history

---

## Implementation Order

| Step | Task | Dependencies | Scope |
|------|------|-------------|-------|
| **1** | Parent Portal: Models + Migrations | None | Backend |
| **2** | Parent Portal: PARENT role + permissions | Step 1 | Backend |
| **3** | Parent Portal: Registration + invite flow | Steps 1-2 | Backend |
| **4** | Parent Portal: Child data APIs (attendance, fees, timetable, results) | Steps 1-2 | Backend |
| **5** | Parent Portal: Leave request APIs | Steps 1-2 | Backend |
| **6** | Parent Portal: Messaging APIs | Steps 1-2 | Backend |
| **7** | Parent Portal: Frontend (dashboard, child pages, leave, messages) | Steps 3-6 | Frontend |
| **8** | Discount/Scholarship: Models + Migrations | None | Backend |
| **9** | Discount/Scholarship: APIs + fee calc integration | Step 8 | Backend |
| **10** | Discount/Scholarship: Frontend pages | Step 9 | Frontend |
| **11** | Payment Gateway: Models + abstraction layer | None | Backend |
| **12** | Payment Gateway: Stripe/Razorpay implementation | Step 11 | Backend |
| **13** | Payment Gateway: Webhook handlers | Step 12 | Backend |
| **14** | Payment Gateway: Frontend (pay button in parent portal, admin config) | Steps 7, 12 | Frontend |
| **15** | Admission CRM: Models + Migrations | None | Backend |
| **16** | Admission CRM: APIs (CRUD, pipeline, conversion) | Step 15 | Backend |
| **17** | Admission CRM: Frontend (dashboard, kanban, forms) | Step 16 | Frontend |
| **18** | Integration: Notification triggers for new features | Steps 5, 12, 16 | Backend |
| **19** | Tests: Comprehensive test suite for Phase 3 | All | Testing |

### Parallel Tracks

Steps 1-7 (Parent Portal), 8-10 (Discounts), and 11-13 (Payment Gateway backend) can be developed in parallel since they have no cross-dependencies until step 14.

---

## Technical Notes

### Consistency with Existing Patterns
- All models use `school` FK for tenant isolation
- `DecimalField(max_digits=12, decimal_places=2)` for money fields
- `created_at` (auto_now_add) + `updated_at` (auto_now) timestamps
- JSONField with `default=dict` for flexible config/metadata
- Status fields use CharField with choices (not IntegerField)
- Register new modules in `MODULE_REGISTRY` with dependencies
- Frontend uses React Query (`useQuery` / `useMutation`) for data fetching
- API endpoints added to domain sections in `api.js`
- Navigation items gated by `isModuleEnabled()` + role checks

### New Dependencies Required
- **Backend:** `stripe` or `razorpay` Python SDK (depending on gateway choice)
- **Frontend:** Potentially `@dnd-kit/core` (only if stretch goal S1 is pursued)

### Database Migrations
- `parents`: 4 new tables (ParentProfile, ParentChild, ParentLeaveRequest, ParentMessage) + ParentInvite
- `finance`: 4 new tables (PaymentGatewayConfig, OnlinePayment, Discount, Scholarship, StudentDiscount)
- `admissions`: 4 new tables (AdmissionSession, AdmissionEnquiry, AdmissionDocument, AdmissionNote)
- `users`: Add PARENT to role choices

### Security Considerations
- Payment gateway credentials stored in environment variables (not DB plain text)
- Webhook endpoints verified by signature (no auth token)
- Parent can ONLY access their linked children's data
- Rate limiting on payment initiation (prevent abuse)
- Parent registration requires valid invite code (no open registration)

---

## Success Criteria

- [ ] Parents can register, log in, and view all children's data
- [ ] Parents can see attendance calendar, fee status, exam results, timetable
- [ ] Parents can apply for child's leave and message teachers
- [ ] At least one payment gateway (Stripe or Razorpay) processes payments end-to-end
- [ ] Fee calculations correctly apply discounts and scholarships
- [ ] Sibling discounts auto-detect and apply
- [ ] Admission enquiries can be created, tracked through pipeline, and converted to students
- [ ] All existing functionality continues working (zero regressions)
- [ ] Module registry updated — new modules can be toggled per school
- [ ] All new features covered by tests

---

## Expected Coverage After Phase 3

| Pillar | Before | After | Change |
|--------|--------|-------|--------|
| Core Administration | 67% | 70% | +3% |
| Communication Hub | 57% | 60% | +3% |
| **Parent Interface** | **0%** | **~70%** | **+70%** |
| Mobile Super App | 14% | 14% | — |
| Academics & Learning | 50% | 50% | — |
| **Finance & Operations** | **70%** | **~85%** | **+15%** |
| AI Autonomous Layer | 50% | 50% | — |
| **Growth & Marketing** | **10%** | **~25%** | **+15%** |
| Student Interface | 0% | 0% | — |
| **OVERALL** | **43%** | **~58%** | **+15%** |
