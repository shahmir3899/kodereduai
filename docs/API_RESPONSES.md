# API Sample Responses

All responses captured from live endpoints on **2026-02-17**.
School 1 = "The Focus Montessori and School - Branch 1" (real data).
School 37 = "SEED_TEST_School_Alpha" (seed/test data).

> **Pagination format** (all list endpoints):
> ```json
> { "count": N, "next": "url|null", "previous": "url|null", "results": [...] }
> ```

---

## Auth & Users

### POST /api/auth/login/
```json
{
  "refresh": "eyJhbGciOiJIUzI1NiIs...",
  "access": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 4,
    "username": "focus3899",
    "email": "shahmir3899@yahoo.com",
    "role": "SCHOOL_ADMIN",
    "role_display": "School Admin",
    "school_id": 2,
    "school_name": "The Focus Montessori and School - Branch 2",
    "is_super_admin": false,
    "organization_id": null,
    "organization_name": null,
    "schools": [
      {
        "id": 1,
        "name": "The Focus Montessori and School - Branch 1",
        "role": "SCHOOL_ADMIN",
        "is_default": true,
        "enabled_modules": {
          "attendance": true, "finance": true, "hr": true,
          "academics": true, "examinations": true, "students": true,
          "notifications": true, "parents": false, "admissions": true,
          "lms": false, "transport": false, "library": false,
          "hostel": false, "inventory": false
        }
      }
    ]
  }
}
```

### GET /api/auth/me/
```json
{
  "id": 4,
  "username": "focus3899",
  "email": "shahmir3899@yahoo.com",
  "first_name": "Syed Shah",
  "last_name": "Mir Ul Hassan",
  "role": "SCHOOL_ADMIN",
  "role_display": "School Admin",
  "school": 1,
  "school_id": 1,
  "school_details": {
    "id": 1,
    "name": "The Focus Montessori and School - Branch 1",
    "subdomain": "focus",
    "logo": null,
    "enabled_modules": { "hr": true, "finance": true, "students": true, "academics": true, "admissions": true, "attendance": true, "examinations": true, "notifications": true }
  },
  "phone": "03339658703",
  "profile_photo_url": null,
  "is_super_admin": false,
  "is_school_admin": true,
  "is_staff_member": false,
  "organization": null,
  "organization_name": null,
  "schools": [ "...same as login response..." ]
}
```

---

## Schools

### GET /api/schools/current/
```json
{
  "id": 1,
  "name": "The Focus Montessori and School - Branch 1",
  "subdomain": "focus",
  "logo": null,
  "address": "Usterzai Payan Kohat",
  "contact_email": "thefocus2018@gmail.com",
  "contact_phone": "03329831884",
  "whatsapp_sender_id": "",
  "enabled_modules": {
    "hr": true, "finance": true, "students": true, "academics": true,
    "admissions": true, "attendance": true, "examinations": true, "notifications": true
  },
  "mark_mappings": {
    "LATE": [],
    "LEAVE": ["Le", "LE", "le", "L"],
    "ABSENT": ["A", "a", "✗", "✘", "X", "AA"],
    "PRESENT": ["P", "p", "✓", "✔", "/", "1", "PP"],
    "default": "ABSENT"
  },
  "register_config": {
    "orientation": "rows_are_students",
    "data_start_col": 2, "data_start_row": 1,
    "date_header_row": 0, "roll_number_col": 1, "student_name_col": 0
  }
}
```

### GET /api/schools/mark_mappings/
```json
{
  "mark_mappings": {
    "LATE": [],
    "LEAVE": ["Le", "LE", "le", "L"],
    "ABSENT": ["A", "a", "✗", "✘", "X", "AA"],
    "PRESENT": ["P", "p", "✓", "✔", "/", "1", "PP"],
    "default": "ABSENT"
  },
  "school_name": "The Focus Montessori and School - Branch 1"
}
```

---

## Classes

### GET /api/classes/
```json
{
  "count": 17,
  "results": [
    {
      "id": 1,
      "school": 1,
      "school_name": "The Focus Montessori and School - Branch 1",
      "name": "Playgroup",
      "section": "",
      "grade_level": 0,
      "is_active": true,
      "student_count": 34,
      "created_at": "2026-02-03T09:35:53.701239+05:00",
      "updated_at": "2026-02-03T09:35:53.701252+05:00"
    }
  ]
}
```

---

## Students

### GET /api/students/
Query params: `class_obj`, `search`, `status`, `is_active`, `page_size`
```json
{
  "count": 382,
  "results": [
    {
      "id": 182,
      "school": 1,
      "school_name": "The Focus Montessori and School - Branch 1",
      "class_obj": 1,
      "class_name": "Playgroup",
      "roll_number": "1",
      "name": "Eshaal Fatima",
      "admission_number": "",
      "admission_date": null,
      "date_of_birth": null,
      "gender": "",
      "blood_group": "",
      "address": "",
      "previous_school": "",
      "parent_phone": "",
      "parent_name": "",
      "guardian_name": "",
      "guardian_relation": "",
      "guardian_phone": "",
      "guardian_email": "",
      "guardian_occupation": "",
      "guardian_address": "",
      "emergency_contact": "",
      "is_active": true,
      "status": "ACTIVE",
      "status_date": null,
      "status_reason": "",
      "has_user_account": false,
      "user_username": null,
      "created_at": "2026-02-11T11:33:34.898282+05:00",
      "updated_at": "2026-02-11T11:33:34.898294+05:00"
    }
  ]
}
```

---

## Attendance

### GET /api/attendance/uploads/
Query params: `class_obj`, `date`, `status`, `page_size`
```json
{
  "count": 6,
  "results": [
    {
      "id": 27,
      "school": 1,
      "school_name": "The Focus Montessori and School - Branch 1",
      "class_obj": 8,
      "class_name": "Class 5",
      "date": "2026-02-04",
      "academic_year": null,
      "academic_year_name": null,
      "image_url": "https://qwgslpkbytwitokaanvm.supabase.co/storage/v1/object/public/atten-reg/attendance/1/8/20260216_160923_6233c229.jpg",
      "status": "REVIEW_REQUIRED",
      "status_display": "Review Required",
      "confidence_score": "1.00",
      "error_message": "AI processing failed at google_vision: Parse error: 'y_min'",
      "created_by": 3,
      "created_by_name": "principalbr1",
      "confirmed_at": null,
      "created_at": "2026-02-16T16:09:41.521614+05:00",
      "updated_at": "2026-02-16T21:19:49.197608+05:00"
    }
  ]
}
```

### GET /api/attendance/uploads/{id}/ (detail)
Same fields as above plus:
```json
{
  "...all list fields...",
  "ai_output_json": { "...raw AI output..." },
  "ocr_raw_text": "...raw OCR text...",
  "structured_table_json": { "...table extraction..." },
  "matched_students": [
    { "student_id": 311, "name": "Anum Batool", "roll_number": "1", "status": "PRESENT", "confidence": 0.95 }
  ],
  "unmatched_entries": [
    { "raw_text": "unknown name", "possible_matches": [] }
  ]
}
```

### GET /api/attendance/records/
Query params: `class_obj`, `student`, `date`, `date_from`, `date_to`, `status`, `source`, `academic_year`, `page_size`
```json
{
  "count": 78,
  "results": [
    {
      "id": 79,
      "school": 1,
      "student": 311,
      "student_name": "Anum Batool",
      "student_roll": "1",
      "class_name": "Class 5",
      "date": "2026-02-13",
      "status": "PRESENT",
      "status_display": "Present",
      "source": "IMAGE_AI",
      "source_display": "Image AI",
      "upload": 18,
      "academic_year": null,
      "academic_year_name": null,
      "notification_sent": false,
      "notification_sent_at": null,
      "created_at": "2026-02-14T14:31:51.169018+05:00",
      "updated_at": "2026-02-14T14:31:51.169039+05:00"
    }
  ]
}
```

### GET /api/attendance/records/accuracy_stats/
```json
{
  "school_name": "The Focus Montessori and School - Branch 1",
  "period_stats": {
    "period_days": 30,
    "total_corrections": 5,
    "attendance_corrections": 3,
    "false_positives": 0,
    "false_negatives": 3,
    "name_mismatches": 1,
    "roll_mismatches": 1,
    "total_predictions": 0,
    "uploads_confirmed": 3,
    "accuracy": null,
    "accuracy_pct": "N/A"
  },
  "weekly_trend": [
    {
      "week_start": "2026-01-20",
      "week_end": "2026-01-27",
      "uploads_processed": 0,
      "total_predictions": 0,
      "corrections": 0,
      "accuracy": null,
      "accuracy_pct": "N/A"
    }
  ]
}
```

---

## Academic Sessions

### GET /api/sessions/academic-years/
```json
{
  "count": 2,
  "results": [
    {
      "id": 31,
      "school": 37,
      "name": "P1SESS_2025-2026",
      "start_date": "2025-04-01",
      "end_date": "2026-03-31",
      "is_current": true,
      "is_active": true,
      "terms_count": 11,
      "enrollment_count": 22,
      "created_at": "2026-02-15T23:24:21.662965+05:00",
      "updated_at": "2026-02-15T23:24:28.212233+05:00"
    }
  ]
}
```

### GET /api/sessions/terms/
```json
{
  "count": 3,
  "results": [
    {
      "id": 37,
      "school": 37,
      "academic_year": 26,
      "academic_year_name": "SEED_TEST_2025-2026",
      "name": "SEED_TEST_Term 1",
      "term_type": "TERM",
      "order": 1,
      "start_date": "2025-04-01",
      "end_date": "2025-09-30",
      "is_current": true,
      "is_active": true,
      "created_at": "2026-02-15T23:04:05.515005+05:00",
      "updated_at": "2026-02-15T23:04:05.515016+05:00"
    }
  ]
}
```

### GET /api/sessions/enrollments/
Query params: `academic_year`, `class_obj`, `student`, `status`, `page_size`
```json
{
  "count": 11,
  "results": [
    {
      "id": 247,
      "school": 37,
      "student": 611,
      "student_name": "SEED_TEST_Ali Hassan",
      "academic_year": 31,
      "academic_year_name": "P1SESS_2025-2026",
      "class_obj": 73,
      "class_name": "SEED_TEST_Class_1A",
      "roll_number": "1",
      "status": "ACTIVE",
      "is_active": true,
      "created_at": "2026-02-17T13:36:17.470801+05:00",
      "updated_at": "2026-02-17T13:36:17.470819+05:00"
    }
  ]
}
```

### GET /api/sessions/health/
```json
{
  "academic_year": {
    "id": 31, "name": "P1SESS_2025-2026",
    "start_date": "2025-04-01", "end_date": "2026-03-31"
  },
  "enrollment": {
    "total_enrolled": 11, "capacity": 11, "enrollment_rate": 100.0
  },
  "attendance": {
    "average_attendance_rate": 0, "current_term_rate": null,
    "previous_term_rate": null, "chronic_absentees": 0, "total_records": 0
  },
  "fee_collection": {
    "total_expected": 0.0, "total_collected": 0.0,
    "collection_rate": 0, "defaulting_students": 0
  },
  "exam_performance": {
    "average_pass_rate": 0, "average_score": 0, "total_exams": 0
  },
  "staff": {
    "total_staff": 3, "staff_attendance_rate": 0, "leaves_this_term": 0
  },
  "ai_summary": {
    "highlights": [
      "The enrollment rate is at 100%, indicating a strong start to the session.",
      "There are no chronic absentees, suggesting good student attendance habits."
    ],
    "concerns": [],
    "recommendations": []
  }
}
```

---

## Finance

### GET /api/finance/accounts/
```json
{
  "count": 5,
  "results": [
    {
      "id": 4,
      "school": null,
      "name": "Abdul Abbas",
      "account_type": "PERSON",
      "opening_balance": "-2223.00",
      "is_active": true,
      "staff_visible": false,
      "created_at": "2026-02-11T11:46:34.236379+05:00",
      "updated_at": "2026-02-11T11:46:34.236402+05:00"
    }
  ]
}
```

### GET /api/finance/fee-structures/
Query params: `class_obj`, `student`, `academic_year`, `is_active`, `page_size`
```json
{
  "count": 234,
  "results": [
    {
      "id": 703,
      "school": 1,
      "school_name": "The Focus Montessori and School - Branch 1",
      "class_obj": null,
      "class_name": null,
      "student": 18,
      "student_name": "Ashal Abbas",
      "academic_year": null,
      "academic_year_name": null,
      "monthly_amount": "1750.00",
      "effective_from": "2026-02-01",
      "effective_to": null,
      "is_active": true,
      "created_at": "2026-02-11T15:28:56.656263+05:00",
      "updated_at": "2026-02-11T15:28:56.656289+05:00"
    }
  ]
}
```

### GET /api/finance/fee-payments/
Query params: `student`, `class_obj`, `month`, `year`, `status`, `academic_year`, `account`, `page_size`
```json
{
  "count": 234,
  "results": [
    {
      "id": 888,
      "school": 1,
      "student": 182,
      "student_name": "Eshaal Fatima",
      "student_roll": "1",
      "class_name": "Playgroup",
      "academic_year": null,
      "academic_year_name": null,
      "month": 2,
      "year": 2026,
      "previous_balance": "0.00",
      "amount_due": "900.00",
      "amount_paid": "900.00",
      "status": "PAID",
      "payment_date": "2026-02-11",
      "payment_method": "CASH",
      "receipt_number": "",
      "notes": "",
      "collected_by": null,
      "collected_by_name": null,
      "account": 1,
      "account_name": "Principal",
      "created_at": "2026-02-11T15:33:41.743408+05:00",
      "updated_at": "2026-02-11T15:33:41.743440+05:00"
    }
  ]
}
```

### GET /api/finance/expenses/
Query params: `category`, `account`, `date_from`, `date_to`, `page_size`
```json
{
  "count": 18,
  "results": [
    {
      "id": 18,
      "school": 1,
      "category": "RENT",
      "category_display": "Rent",
      "amount": "31200.00",
      "date": "2026-02-10",
      "description": "Rent for Jan 26 and Feb 26",
      "recorded_by": null,
      "recorded_by_name": null,
      "account": 4,
      "account_name": "Abdul Abbas",
      "is_sensitive": false,
      "created_at": "2026-02-11T19:53:39.340113+05:00",
      "updated_at": "2026-02-11T19:53:39.340124+05:00"
    }
  ]
}
```

### GET /api/finance/discounts/
_(No data — expected fields)_
```json
{
  "results": [
    {
      "id": 0, "school": 0, "name": "", "discount_type": "PERCENTAGE|FIXED",
      "value": "0.00", "applies_to": "", "is_active": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/finance/gateway-config/
_(Empty paginated response — no gateway configured)_

### GET /api/finance/balances/
Returns empty body when no accounts with balance tracking exist.

### GET /api/finance/monthly_summary/
Returns empty body when no data for current period.

---

## HR

### GET /api/hr/staff/
```json
{
  "count": 1,
  "results": [
    {
      "id": 43,
      "school": 1,
      "user": null,
      "user_username": null,
      "first_name": "Anila",
      "last_name": "Riaz",
      "full_name": "Anila Riaz",
      "email": "",
      "phone": "",
      "gender": "",
      "date_of_birth": null,
      "photo_url": null,
      "employee_id": "EMP-001",
      "department": 30,
      "department_name": "Administration",
      "designation": 31,
      "designation_name": "Principal",
      "employment_type": "FULL_TIME",
      "employment_status": "ACTIVE",
      "date_of_joining": null,
      "date_of_leaving": null,
      "address": "",
      "emergency_contact_name": "",
      "emergency_contact_phone": "",
      "notes": "",
      "is_active": true,
      "created_at": "2026-02-15T15:26:53.087550+05:00",
      "updated_at": "2026-02-15T15:26:53.087575+05:00"
    }
  ]
}
```

### GET /api/hr/departments/
```json
{
  "count": 4,
  "results": [
    {
      "id": 31,
      "school": 1,
      "name": "IT / Lab",
      "description": "IT support and laboratory staff",
      "is_active": true,
      "staff_count": 0,
      "created_at": "2026-02-15T15:02:42.185897+05:00",
      "updated_at": "2026-02-15T15:02:42.185921+05:00"
    }
  ]
}
```

### GET /api/hr/designations/
```json
{
  "count": 5,
  "results": [
    {
      "id": 34,
      "school": 1,
      "name": "IT Administrator",
      "department": 31,
      "department_name": "IT / Lab",
      "is_active": true,
      "created_at": "2026-02-15T15:03:08.658408+05:00",
      "updated_at": "2026-02-15T15:08:51.144983+05:00"
    }
  ]
}
```

### GET /api/hr/leave-policies/
```json
{
  "count": 1,
  "results": [
    {
      "id": 6,
      "school": 1,
      "name": "Leave Policy",
      "leave_type": "ANNUAL",
      "leave_type_display": "Annual Leave",
      "days_allowed": 48,
      "carry_forward": false,
      "is_active": true,
      "applications_count": 0,
      "created_at": "2026-02-15T14:55:13.461730+05:00",
      "updated_at": "2026-02-15T14:55:13.461761+05:00"
    }
  ]
}
```

### GET /api/hr/salary-structures/
_(No data — expected fields from serializer)_
```json
{
  "results": [
    {
      "id": 0, "school": 0, "staff": 0, "staff_name": "",
      "basic_salary": "0.00", "allowances": {}, "deductions": {},
      "gross_salary": "0.00", "net_salary": "0.00",
      "effective_from": "2026-01-01", "is_current": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/hr/payslips/
_(No data — expected fields from serializer)_
```json
{
  "results": [
    {
      "id": 0, "school": 0, "staff": 0, "staff_name": "",
      "salary_structure": 0, "month": 1, "year": 2026,
      "basic_amount": "0.00", "allowances": {}, "deductions": {},
      "gross_amount": "0.00", "net_amount": "0.00",
      "status": "DRAFT|APPROVED|PAID",
      "approved_by": null, "approved_by_name": null, "paid_date": null,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/hr/dashboard_stats/
Returns empty body when no substantial HR data exists.

---

## Examinations

_(No exam data in current schools — expected fields from serializers)_

### GET /api/examinations/exam-types/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "name": "", "weight": 0,
      "is_active": true, "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/examinations/exams/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "academic_year": 0, "academic_year_name": "",
      "term": null, "term_name": null, "exam_type": 0, "exam_type_name": "",
      "class_obj": 0, "class_name": "", "name": "",
      "start_date": "", "end_date": "", "status": "",
      "subjects_count": 0, "is_active": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/examinations/exam-subjects/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "exam": 0, "exam_name": "",
      "subject": 0, "subject_name": "", "subject_code": "",
      "total_marks": 0, "passing_marks": 0, "exam_date": null,
      "is_active": true, "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/examinations/marks/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "exam_subject": 0,
      "student": 0, "student_name": "", "student_roll_number": "",
      "subject_name": "", "total_marks": 0, "passing_marks": 0,
      "marks_obtained": "0.00", "is_absent": false, "remarks": "",
      "percentage": 0.0, "is_pass": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/examinations/grade-scales/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "grade_label": "A+",
      "min_percentage": "90.00", "max_percentage": "100.00",
      "gpa_points": "4.00", "order": 1, "is_active": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

---

## Admissions

### GET /api/admissions/enquiries/
Query params: `status`, `source`, `applying_for_grade_level`, `search`, `page_size`
```json
{
  "count": 2,
  "results": [
    {
      "id": 11,
      "name": "Mahnoor Fatima",
      "father_name": "Mahlib Hussain",
      "mobile": "03329633098",
      "applying_for_grade_level": 0,
      "status": "CONVERTED",
      "status_display": "Converted",
      "source": "WALK_IN",
      "source_display": "Walk-in",
      "next_followup_date": null,
      "created_at": "2026-02-16T22:46:11.205754+05:00",
      "updated_at": "2026-02-17T13:52:57.580213+05:00"
    }
  ]
}
```

---

## Notifications

### GET /api/notifications/config/
```json
{
  "id": 2,
  "school": 1,
  "school_name": "The Focus Montessori and School - Branch 1",
  "whatsapp_enabled": true,
  "sms_enabled": false,
  "in_app_enabled": true,
  "email_enabled": false,
  "quiet_hours_start": null,
  "quiet_hours_end": null,
  "fee_reminder_day": 5,
  "daily_absence_summary_time": null,
  "created_at": "2026-02-13T13:01:53.878412+05:00",
  "updated_at": "2026-02-13T13:01:53.878432+05:00"
}
```

### GET /api/notifications/unread-count/
```json
{ "unread_count": 0 }
```

### GET /api/notifications/templates/
_(No data — expected fields from serializer)_
```json
{
  "results": [
    {
      "id": 0, "school": 0, "name": "",
      "event_type": "FEE_DUE|ABSENCE|EXAM|GENERAL",
      "channel": "IN_APP|SMS|EMAIL|WHATSAPP|PUSH",
      "subject_template": "", "body_template": "",
      "is_active": true, "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/notifications/logs/
_(No data — expected fields from serializer)_
```json
{
  "results": [
    {
      "id": 0, "school": 0, "template": null,
      "channel": "IN_APP", "event_type": "GENERAL",
      "recipient_type": "", "recipient_identifier": "",
      "title": "", "body": "",
      "status": "PENDING|SENT|DELIVERED|FAILED|READ",
      "metadata": {}, "sent_at": null,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

---

## Academics

_(No academic data configured in test schools — expected fields from serializers)_

### GET /api/academics/subjects/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "name": "", "code": "",
      "description": "", "is_elective": false, "is_active": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/academics/class-subjects/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "class_obj": 0, "class_name": "",
      "subject": 0, "subject_name": "", "subject_code": "",
      "teacher": null, "teacher_name": null,
      "academic_year": null, "academic_year_name": null,
      "periods_per_week": 0, "is_active": true,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/academics/timetable-slots/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "name": "", "slot_type": "PERIOD|BREAK|ASSEMBLY",
      "slot_type_display": "", "start_time": "08:00:00", "end_time": "08:40:00",
      "order": 1, "is_active": true, "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/academics/timetable-entries/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "class_obj": 0, "class_name": "",
      "day": 0, "day_display": "Monday",
      "slot": 0, "slot_name": "", "slot_order": 0, "slot_type": "",
      "slot_start_time": "", "slot_end_time": "",
      "subject": null, "subject_name": null, "subject_code": null,
      "teacher": null, "teacher_name": null,
      "academic_year": null, "academic_year_name": null,
      "room": null, "created_at": "", "updated_at": ""
    }
  ]
}
```

---

## Hostel

### GET /api/hostel/dashboard/
```json
{
  "total_hostels": 0,
  "total_rooms": 0,
  "total_capacity": 0,
  "current_occupancy": 0,
  "available_beds": 0,
  "pending_gate_passes": 0,
  "boys_hostels": 0,
  "girls_hostels": 0,
  "students_on_leave": 0
}
```

### Expected fields — hostels, rooms, allocations, gate-passes
```json
// GET /api/hostel/hostels/
{
  "id": 0, "school": 0, "school_name": "", "name": "",
  "hostel_type": "BOYS|GIRLS|MIXED", "hostel_type_display": "",
  "warden": null, "warden_name": null,
  "capacity": 0, "current_occupancy": 0, "rooms_count": 0,
  "address": "", "contact_number": "", "is_active": true,
  "created_at": "", "updated_at": ""
}

// GET /api/hostel/rooms/
{
  "id": 0, "hostel": 0, "hostel_name": "",
  "room_number": "", "floor": 0,
  "room_type": "", "room_type_display": "",
  "capacity": 0, "current_occupancy": 0,
  "is_full": false, "is_available": true, "created_at": ""
}

// GET /api/hostel/allocations/
{
  "id": 0, "school": 0, "student": 0, "student_name": "",
  "student_roll_number": "", "student_class_name": "",
  "room": 0, "room_number": "", "hostel_name": "",
  "academic_year": 0, "academic_year_name": "",
  "allocated_date": "", "vacated_date": null,
  "is_active": true, "created_at": ""
}

// GET /api/hostel/gate-passes/
{
  "id": 0, "school": 0, "student": 0, "student_name": "",
  "student_roll_number": "", "allocation": 0,
  "hostel_name": "", "room_number": "",
  "pass_type": "", "pass_type_display": "",
  "reason": "", "going_to": "", "contact_at_destination": "",
  "departure_date": "", "expected_return": "", "actual_return": null,
  "status": "PENDING|APPROVED|REJECTED|OUT|RETURNED",
  "status_display": "", "approved_by": null, "approved_by_name": null,
  "approved_at": null, "remarks": "",
  "created_at": "", "updated_at": ""
}
```

---

## Transport

### GET /api/transport/dashboard/
```json
{
  "total_routes": 0,
  "total_vehicles": 0,
  "students_assigned": 0,
  "today_attendance": 0
}
```

_(Expected fields from serializers)_

```json
// GET /api/transport/routes/
{
  "id": 0, "school": 0, "school_name": "", "name": "",
  "description": "", "start_location": "", "end_location": "",
  "distance_km": null, "estimated_duration_minutes": null,
  "is_active": true, "stops_count": 0, "vehicles_count": 0, "students_count": 0,
  "created_at": "", "updated_at": ""
}

// GET /api/transport/vehicles/
{
  "id": 0, "school": 0, "school_name": "",
  "vehicle_number": "", "vehicle_type": "", "vehicle_type_display": "",
  "capacity": 0, "make_model": "",
  "driver_name": "", "driver_phone": "", "driver_license": "",
  "assigned_route": null, "route_name": null,
  "is_active": true, "created_at": "", "updated_at": ""
}

// GET /api/transport/stops/
{
  "id": 0, "route": 0, "route_name": "", "name": "",
  "address": "", "latitude": null, "longitude": null,
  "stop_order": 1, "pickup_time": null, "drop_time": null
}

// GET /api/transport/assignments/
{
  "id": 0, "school": 0, "academic_year": 0, "academic_year_name": "",
  "student": 0, "student_name": "", "student_roll_number": "", "student_class_name": "",
  "route": 0, "route_name": "",
  "stop": 0, "stop_name": "",
  "vehicle": null, "vehicle_number": null,
  "transport_type": "", "transport_type_display": "",
  "is_active": true, "created_at": ""
}
```

---

## Library

### GET /api/library/stats/
```json
{
  "total_books": 0,
  "total_issued": 0,
  "total_overdue": 0,
  "total_categories": 0,
  "total_fine_collected": 0.0
}
```

### Expected fields — categories, books, issues
```json
// GET /api/library/categories/
{ "id": 0, "school": 0, "name": "", "description": "" }

// GET /api/library/books/
{
  "id": 0, "school": 0, "title": "", "author": "", "isbn": "",
  "publisher": "", "category": 0, "category_name": "",
  "total_copies": 0, "available_copies": 0,
  "available_count": 0, "issued_count": 0,
  "shelf_location": "", "is_active": true,
  "created_at": "", "updated_at": ""
}

// GET /api/library/issues/
{
  "id": 0, "school": 0, "book": 0, "book_title": "",
  "borrower_type": "STUDENT|STAFF",
  "student": null, "staff": null, "borrower_name": "",
  "issue_date": "", "due_date": "", "return_date": null,
  "status": "ISSUED|RETURNED|OVERDUE|LOST",
  "fine_amount": "0.00",
  "issued_by": null, "issued_by_name": null
}
```

---

## Inventory

### GET /api/inventory/categories/
```json
{
  "count": 1,
  "results": [
    {
      "id": 1,
      "school": 37,
      "name": "P17INV_Electronics",
      "description": "Updated description",
      "items_count": 1,
      "is_active": true,
      "created_at": "2026-02-15T23:39:53.734019+05:00"
    }
  ]
}
```

### GET /api/inventory/items/
```json
{
  "count": 1,
  "results": [
    {
      "id": 1,
      "school": 37,
      "category": 1,
      "category_name": "P17INV_Electronics",
      "name": "P17INV_Projector",
      "sku": "P17INV_PROJ-001",
      "unit": "PCS",
      "unit_display": "Pieces",
      "current_stock": 3,
      "minimum_stock": 5,
      "unit_price": "25000.00",
      "stock_value": "75000.00",
      "is_low_stock": true,
      "location": "Room 102",
      "is_active": true,
      "active_assignments_count": 0,
      "created_at": "2026-02-15T23:40:01.214290+05:00",
      "updated_at": "2026-02-15T23:48:31.654804+05:00"
    }
  ]
}
```

### GET /api/inventory/transactions/
```json
{
  "count": 2,
  "results": [
    {
      "id": 4,
      "school": 37,
      "item": 1,
      "item_name": "P17INV_Projector",
      "item_unit": "Pieces",
      "transaction_type": "ISSUE",
      "transaction_type_display": "Issue",
      "quantity": -2,
      "unit_price": "0.00",
      "total_amount": "0.00",
      "vendor": null,
      "vendor_name": null,
      "assignment": null,
      "reference_number": "P17INV_ISS-001",
      "remarks": "P17INV_Issued to lab",
      "date": "2026-02-15",
      "recorded_by": 134,
      "recorded_by_name": "SEED_TEST_admin",
      "created_at": "2026-02-15T23:40:13.144917+05:00"
    }
  ]
}
```

### GET /api/inventory/dashboard/
```json
{
  "total_items": 1,
  "total_value": 75000.0,
  "low_stock_count": 1,
  "active_assignments": 0,
  "total_categories": 1,
  "total_vendors": 0,
  "recent_transactions": [ "...same as transactions list..." ]
}
```

---

## LMS

_(No data — expected fields from serializers)_

### GET /api/lms/lesson-plans/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "school_name": "",
      "academic_year": 0, "academic_year_name": "",
      "class_obj": 0, "class_name": "",
      "subject": 0, "subject_name": "",
      "teacher": 0, "teacher_name": "",
      "title": "", "description": "", "objectives": "",
      "lesson_date": "", "duration_minutes": 40,
      "materials_needed": "", "teaching_methods": "",
      "status": "DRAFT|PUBLISHED", "status_display": "",
      "is_active": true, "attachments": [],
      "created_at": "", "updated_at": ""
    }
  ]
}
```

### GET /api/lms/assignments/
```json
{
  "results": [
    {
      "id": 0, "school": 0, "school_name": "",
      "academic_year": 0, "academic_year_name": "",
      "class_obj": 0, "class_name": "",
      "subject": 0, "subject_name": "",
      "teacher": 0, "teacher_name": "",
      "title": "", "description": "", "instructions": "",
      "assignment_type": "", "assignment_type_display": "",
      "due_date": "", "total_marks": 0,
      "attachments_allowed": true,
      "status": "DRAFT|PUBLISHED|CLOSED", "status_display": "",
      "is_active": true, "attachments": [], "submission_count": 0,
      "created_at": "", "updated_at": ""
    }
  ]
}
```

---

## Reports & Tasks

### GET /api/reports/list/
```json
[]
```
_(Empty array when no reports generated)_

### GET /api/tasks/tasks/
```json
{ "count": 0, "next": null, "previous": null, "results": [] }
```

---

## Faulty / Non-Responsive Endpoints

| Endpoint | Issue |
|----------|-------|
| GET /api/finance/balances/ | Returns empty body (no response) |
| GET /api/finance/monthly_summary/ | Returns empty body (no response) |
| GET /api/hr/dashboard_stats/ | Returns empty body (no response) |
| GET /api/attendance/records/mapping_suggestions/ | Not tested (may require correction data) |
| GET /api/students/{id}/profile_summary/ | Requires valid student ID with data |
| POST /api/attendance/upload-image/ | Requires multipart file upload |
| POST /api/attendance/uploads/{id}/confirm/ | Requires upload in REVIEW_REQUIRED status |

---

## Incomplete CRUD Report

The following endpoints were found to **return 404** or have **missing operations**:

### Missing Endpoints (404)
| Expected URL | Status | Notes |
|-------------|--------|-------|
| /api/student-documents/ | 404 | Not implemented — no such URL registered |
| /api/student-profiles/ | 404 | Not implemented — profile data is in /api/students/ |
| /api/student-invites/ | 404 | Not implemented |
| /api/finance/monthly-closings/ | 404 | Not implemented |
| /api/finance/account-snapshots/ | 404 | Not implemented |
| /api/finance/payment-gateways/ | 404 | Actual path is /api/finance/gateway-config/ |
| /api/admissions/analytics/pipeline/ | 404 | Not implemented |
| /api/reports/ | 404 | Actual paths: /api/reports/list/ and /api/reports/generate/ |
| /api/parents/messages/ (GET) | 405 | GET not allowed — only POST; threads at /api/parents/messages/threads/ |

### URL Gotchas (hyphens vs underscores)
- Attendance custom actions use **underscores**: `pending_review`, `daily_report`, `accuracy_stats`, `mapping_suggestions`, `profile_summary`, `dashboard_stats`, `monthly_summary`
- Router-generated CRUD endpoints use **hyphens**: `fee-structures`, `fee-payments`, `leave-policies`, etc.

### Modules with No DELETE endpoint
Most ViewSets use `ModelViewSet` which includes DELETE. However, verify these if cleanup is needed:
- `AttendanceRecord` — no explicit destroy action seen
- `FeePayment` — payments generally shouldn't be deleted
- `NotificationLog` — logs are append-only
- `StudentEnrollment` — managed via promotion flow, not direct delete
