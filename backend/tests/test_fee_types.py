"""
Fee Types -- Multi-Type Fee System Tests (pytest)
==================================================
Covers:
  A. FeeStructure CRUD with fee_type (MONTHLY, ANNUAL, ADMISSION, BOOKS, FINE)
  B. FeePayment creation and filtering by fee_type
  C. resolve_fee_amount() by fee_type (student-level vs class-level priority)
  D. generate_onetime_fees endpoint
  E. Batch-convert with fee generation (admissions → finance integration)
  F. Monthly summary with fee_type filter
  G. Bulk fee structure with fee_type
  H. Permissions & school isolation
"""

import pytest
from datetime import date, timedelta
from decimal import Decimal


pytestmark = [pytest.mark.django_db, pytest.mark.fee_types]


# ====================================================================
# Helpers
# ====================================================================

def _results(resp):
    """Unwrap paginated or plain list responses."""
    data = resp.json() if resp.status_code in (200, 201) else []
    if isinstance(data, dict):
        data = data.get('results', data)
    return data


FEE_TYPES = ['MONTHLY', 'ANNUAL', 'ADMISSION', 'BOOKS', 'FINE']


# ====================================================================
# Shared fixture: Fee structures for multiple fee types
# ====================================================================

@pytest.fixture
def fee_structures(seed_data, api):
    """Create fee structures for all 5 fee types on class_1."""
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']
    class_1 = seed_data['classes'][0]

    created = {}
    amounts = {
        'MONTHLY': '2500.00',
        'ANNUAL': '15000.00',
        'ADMISSION': '10000.00',
        'BOOKS': '3000.00',
        'FINE': '500.00',
    }

    for ft, amount in amounts.items():
        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': ft,
            'monthly_amount': amount,
            'effective_from': str(date.today() - timedelta(days=30)),
        }, token, sid)
        assert resp.status_code == 201, f"Setup: create {ft} structure failed: {resp.status_code} {resp.content[:200]}"
        created[ft] = resp.json()

    return created


# ====================================================================
# LEVEL A: FEE STRUCTURE CRUD WITH FEE_TYPE
# ====================================================================

class TestFeeStructureFeeType:
    """FeeStructure CRUD operations with fee_type field."""

    def test_create_monthly_structure(self, seed_data, api):
        """A1 - Create a MONTHLY fee structure."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': 'MONTHLY',
            'monthly_amount': '2500.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A1 Create MONTHLY: {resp.status_code} {resp.content[:300]}"
        assert resp.json()['fee_type'] == 'MONTHLY'

    def test_create_annual_structure(self, seed_data, api):
        """A2 - Create an ANNUAL fee structure."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': 'ANNUAL',
            'monthly_amount': '15000.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A2 Create ANNUAL: {resp.status_code}"
        assert resp.json()['fee_type'] == 'ANNUAL'

    def test_create_admission_structure(self, seed_data, api):
        """A3 - Create an ADMISSION fee structure."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': 'ADMISSION',
            'monthly_amount': '10000.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A3 Create ADMISSION: {resp.status_code}"
        assert resp.json()['fee_type'] == 'ADMISSION'

    def test_create_books_structure(self, seed_data, api):
        """A4 - Create a BOOKS fee structure."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': 'BOOKS',
            'monthly_amount': '3000.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A4 Create BOOKS: {resp.status_code}"
        assert resp.json()['fee_type'] == 'BOOKS'

    def test_create_fine_structure(self, seed_data, api):
        """A5 - Create a FINE fee structure."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': 'FINE',
            'monthly_amount': '500.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A5 Create FINE: {resp.status_code}"
        assert resp.json()['fee_type'] == 'FINE'

    def test_default_fee_type_is_monthly(self, seed_data, api):
        """A6 - If no fee_type is passed, it defaults to MONTHLY."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_2 = seed_data['classes'][1]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_2.id,
            'monthly_amount': '2000.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A6 Default fee_type: {resp.status_code}"
        assert resp.json()['fee_type'] == 'MONTHLY'

    def test_filter_structures_by_fee_type(self, seed_data, api, fee_structures):
        """A7 - Filter fee structures by fee_type query param."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/finance/fee-structures/?fee_type=ANNUAL', token, sid)
        data = _results(resp)

        assert resp.status_code == 200, f"A7 Filter: {resp.status_code}"
        assert len(data) >= 1, "A7 Expected at least 1 ANNUAL structure"
        assert all(d['fee_type'] == 'ANNUAL' for d in data), "A7 Non-ANNUAL in results"

    def test_student_level_structure(self, seed_data, api):
        """A8 - Student-level fee structure can be created."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][0]

        # Student-level: only pass student (not class_obj)
        resp = api.post('/api/finance/fee-structures/', {
            'student': student.id,
            'fee_type': 'ADMISSION',
            'monthly_amount': '8000.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 201, f"A8 Student-level: {resp.status_code} {resp.content[:300]}"
        assert resp.json()['fee_type'] == 'ADMISSION'

    def test_read_structure_has_display_field(self, seed_data, api, fee_structures):
        """A9 - GET response includes fee_type_display."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/finance/fee-structures/?fee_type=ANNUAL', token, sid)
        data = _results(resp)

        assert resp.status_code == 200
        assert len(data) >= 1
        assert data[0]['fee_type_display'] == 'Annual'


# ====================================================================
# LEVEL B: FEE PAYMENT CREATION WITH FEE_TYPE
# ====================================================================

class TestFeePaymentFeeType:
    """FeePayment creation and filtering by fee_type."""

    def test_create_monthly_payment(self, seed_data, api):
        """B1 - Create a MONTHLY fee payment (month=1-12)."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][0]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'fee_type': 'MONTHLY',
            'month': 2,
            'year': 2026,
            'amount_due': '2500.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp.status_code == 201, f"B1 Create MONTHLY payment: {resp.status_code} {resp.content[:300]}"
        data = resp.json()
        assert data['fee_type'] == 'MONTHLY'
        assert data['month'] == 2

    def test_create_annual_payment_month_zero(self, seed_data, api):
        """B2 - Create an ANNUAL fee payment (month=0)."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][0]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'fee_type': 'ANNUAL',
            'month': 0,
            'year': 2026,
            'amount_due': '15000.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp.status_code == 201, f"B2 Create ANNUAL: {resp.status_code} {resp.content[:300]}"
        data = resp.json()
        assert data['fee_type'] == 'ANNUAL'
        assert data['month'] == 0

    def test_create_admission_payment(self, seed_data, api):
        """B3 - Create an ADMISSION fee payment."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][1]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'fee_type': 'ADMISSION',
            'month': 0,
            'year': 2026,
            'amount_due': '10000.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp.status_code == 201, f"B3 Create ADMISSION: {resp.status_code} {resp.content[:300]}"
        assert resp.json()['fee_type'] == 'ADMISSION'

    def test_create_books_payment(self, seed_data, api):
        """B4 - Create a BOOKS fee payment."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][1]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'fee_type': 'BOOKS',
            'month': 0,
            'year': 2026,
            'amount_due': '3000.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp.status_code == 201, f"B4 Create BOOKS: {resp.status_code} {resp.content[:300]}"
        assert resp.json()['fee_type'] == 'BOOKS'

    def test_create_fine_payment(self, seed_data, api):
        """B5 - Create a FINE fee payment."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][2]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'fee_type': 'FINE',
            'month': 0,
            'year': 2026,
            'amount_due': '500.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp.status_code == 201, f"B5 Create FINE: {resp.status_code} {resp.content[:300]}"
        assert resp.json()['fee_type'] == 'FINE'

    def test_filter_payments_by_fee_type(self, seed_data, api):
        """B6 - Filter payments by fee_type query param."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][3]

        # Create MONTHLY and ANNUAL for the same student
        api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id, 'fee_type': 'MONTHLY',
            'month': 1, 'year': 2026, 'amount_due': '2500', 'amount_paid': '0',
        }, token, sid)
        api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id, 'fee_type': 'ANNUAL',
            'month': 0, 'year': 2026, 'amount_due': '15000', 'amount_paid': '0',
        }, token, sid)

        resp = api.get('/api/finance/fee-payments/?fee_type=ANNUAL&year=2026&month=0', token, sid)
        data = _results(resp)

        assert resp.status_code == 200, f"B6 Filter: {resp.status_code}"
        assert len(data) >= 1, "B6 Expected at least 1 ANNUAL payment"
        assert all(d['fee_type'] == 'ANNUAL' for d in data), "B6 Non-ANNUAL in results"

    def test_unique_together_allows_different_fee_types(self, seed_data, api):
        """B7 - Same student, same month/year, different fee_types should all succeed."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][4]

        for ft in ['ADMISSION', 'ANNUAL', 'BOOKS']:
            resp = api.post('/api/finance/fee-payments/', {
                'school': sid,
                'student': student.id, 'fee_type': ft,
                'month': 0, 'year': 2026, 'amount_due': '1000', 'amount_paid': '0',
            }, token, sid)
            assert resp.status_code == 201, f"B7 Create {ft}: {resp.status_code} {resp.content[:300]}"

    def test_duplicate_same_fee_type_rejected(self, seed_data, api):
        """B8 - Duplicate (student, month, year, fee_type) should be rejected."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][5]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id, 'fee_type': 'ADMISSION',
            'month': 0, 'year': 2026, 'amount_due': '10000', 'amount_paid': '0',
        }, token, sid)
        assert resp.status_code == 201, f"B8 First create: {resp.status_code} {resp.content[:300]}"

        resp2 = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id, 'fee_type': 'ADMISSION',
            'month': 0, 'year': 2026, 'amount_due': '10000', 'amount_paid': '0',
        }, token, sid)
        assert resp2.status_code in (400, 409, 500), f"B8 Duplicate expected 400/409/500: {resp2.status_code}"

    def test_default_fee_type_on_payment(self, seed_data, api):
        """B9 - If fee_type is omitted, it defaults to MONTHLY."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][6]

        resp = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'month': 3,
            'year': 2026,
            'amount_due': '2500.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp.status_code == 201, f"B9 Default: {resp.status_code} {resp.content[:300]}"
        assert resp.json()['fee_type'] == 'MONTHLY'

    def test_read_payment_has_display_field(self, seed_data, api):
        """B10 - GET response includes fee_type_display."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][7]

        api.post('/api/finance/fee-payments/', {
            'school': sid, 'student': student.id,
            'fee_type': 'ANNUAL', 'month': 0, 'year': 2026,
            'amount_due': '15000', 'amount_paid': '0',
        }, token, sid)

        resp = api.get('/api/finance/fee-payments/?fee_type=ANNUAL&year=2026&month=0', token, sid)
        data = _results(resp)

        assert resp.status_code == 200
        assert len(data) >= 1
        assert data[0]['fee_type_display'] == 'Annual'


# ====================================================================
# LEVEL C: resolve_fee_amount() WITH FEE_TYPE
# ====================================================================

class TestResolveFeeAmount:
    """Test the resolve_fee_amount model function with fee_type parameter."""

    def test_resolve_class_level_monthly(self, seed_data, fee_structures):
        """C1 - resolve_fee_amount returns class-level MONTHLY amount."""
        from finance.models import resolve_fee_amount
        student = seed_data['students'][0]
        amount = resolve_fee_amount(student, 'MONTHLY')
        assert amount == Decimal('2500.00'), f"C1 Expected 2500, got {amount}"

    def test_resolve_class_level_annual(self, seed_data, fee_structures):
        """C2 - resolve_fee_amount returns class-level ANNUAL amount."""
        from finance.models import resolve_fee_amount
        student = seed_data['students'][0]
        amount = resolve_fee_amount(student, 'ANNUAL')
        assert amount == Decimal('15000.00'), f"C2 Expected 15000, got {amount}"

    def test_resolve_class_level_admission(self, seed_data, fee_structures):
        """C3 - resolve_fee_amount returns class-level ADMISSION amount."""
        from finance.models import resolve_fee_amount
        student = seed_data['students'][0]
        amount = resolve_fee_amount(student, 'ADMISSION')
        assert amount == Decimal('10000.00'), f"C3 Expected 10000, got {amount}"

    def test_resolve_class_level_books(self, seed_data, fee_structures):
        """C4 - resolve_fee_amount returns class-level BOOKS amount."""
        from finance.models import resolve_fee_amount
        student = seed_data['students'][0]
        amount = resolve_fee_amount(student, 'BOOKS')
        assert amount == Decimal('3000.00'), f"C4 Expected 3000, got {amount}"

    def test_resolve_class_level_fine(self, seed_data, fee_structures):
        """C5 - resolve_fee_amount returns class-level FINE amount."""
        from finance.models import resolve_fee_amount
        student = seed_data['students'][0]
        amount = resolve_fee_amount(student, 'FINE')
        assert amount == Decimal('500.00'), f"C5 Expected 500, got {amount}"

    def test_resolve_no_structure_returns_none(self, seed_data):
        """C6 - resolve_fee_amount returns None when no structure exists."""
        from finance.models import resolve_fee_amount
        # Class 3 has no fee structures
        student = seed_data['students'][7]  # Class 3
        amount = resolve_fee_amount(student, 'ADMISSION')
        assert amount is None, f"C6 Expected None, got {amount}"

    def test_student_level_overrides_class(self, seed_data, api, fee_structures):
        """C7 - Student-level structure overrides class-level for same fee_type."""
        from finance.models import FeeStructure, resolve_fee_amount
        student = seed_data['students'][0]

        # Create student-level ANNUAL override
        FeeStructure.objects.create(
            school=seed_data['school_a'],
            class_obj=student.class_obj,
            student=student,
            fee_type='ANNUAL',
            monthly_amount=Decimal('12000.00'),
            effective_from=date.today() - timedelta(days=1),
            is_active=True,
        )

        amount = resolve_fee_amount(student, 'ANNUAL')
        assert amount == Decimal('12000.00'), f"C7 Expected 12000 (student override), got {amount}"

    def test_default_fee_type_is_monthly(self, seed_data, fee_structures):
        """C8 - resolve_fee_amount defaults to MONTHLY when fee_type not specified."""
        from finance.models import resolve_fee_amount
        student = seed_data['students'][0]
        amount = resolve_fee_amount(student)
        assert amount == Decimal('2500.00'), f"C8 Expected 2500 (MONTHLY default), got {amount}"


# ====================================================================
# LEVEL D: GENERATE ONE-TIME FEES ENDPOINT
# ====================================================================

class TestGenerateOnetimeFees:
    """Test POST /api/finance/fee-payments/generate_onetime_fees/."""

    def test_generate_admission_and_annual(self, seed_data, api, fee_structures):
        """D1 - Generate ADMISSION + ANNUAL fees for students."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        students = seed_data['students'][:3]  # First 3 (Class 1)
        student_ids = [s.id for s in students]

        resp = api.post('/api/finance/fee-payments/generate_onetime_fees/', {
            'student_ids': student_ids,
            'fee_types': ['ADMISSION', 'ANNUAL'],
            'year': 2026,
        }, token, sid)

        assert resp.status_code == 200, f"D1 Generate: {resp.status_code} {resp.content[:300]}"
        data = resp.json()
        assert data['created'] == 6, f"D1 Expected 6 created (3 students x 2 types), got {data['created']}"

    def test_generate_skips_duplicates(self, seed_data, api, fee_structures):
        """D2 - Re-generating same fee types should skip existing."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][0]

        # First call
        api.post('/api/finance/fee-payments/generate_onetime_fees/', {
            'student_ids': [student.id],
            'fee_types': ['BOOKS'],
            'year': 2026,
        }, token, sid)

        # Second call — should skip
        resp = api.post('/api/finance/fee-payments/generate_onetime_fees/', {
            'student_ids': [student.id],
            'fee_types': ['BOOKS'],
            'year': 2026,
        }, token, sid)

        data = resp.json()
        assert data['created'] == 0, f"D2 Expected 0 created (duplicate), got {data['created']}"
        assert data['skipped'] == 1, f"D2 Expected 1 skipped, got {data['skipped']}"

    def test_generate_no_structure_tracked(self, seed_data, api):
        """D3 - Students with no fee structure for a type are tracked as no_fee_structure."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        # Class 3 student — no fee structures set up
        student = seed_data['students'][7]

        resp = api.post('/api/finance/fee-payments/generate_onetime_fees/', {
            'student_ids': [student.id],
            'fee_types': ['ADMISSION'],
            'year': 2026,
        }, token, sid)

        assert resp.status_code == 200
        data = resp.json()
        assert data['created'] == 0, f"D3 Expected 0 created"
        assert data['no_fee_structure'] >= 1, f"D3 Expected >=1 no_fee_structure"

    def test_generate_validates_required_fields(self, seed_data, api):
        """D4 - Missing required fields returns 400."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/finance/fee-payments/generate_onetime_fees/', {
            'student_ids': [],
            'fee_types': ['ADMISSION'],
            'year': 2026,
        }, token, sid)

        assert resp.status_code == 400, f"D4 Expected 400 for empty student_ids: {resp.status_code}"

    def test_generate_monthly_with_specific_month(self, seed_data, api, fee_structures):
        """D5 - Generate MONTHLY fees with specific month parameter."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        student = seed_data['students'][0]

        resp = api.post('/api/finance/fee-payments/generate_onetime_fees/', {
            'student_ids': [student.id],
            'fee_types': ['MONTHLY'],
            'year': 2026,
            'month': 6,
        }, token, sid)

        assert resp.status_code == 200, f"D5 Generate MONTHLY: {resp.status_code}"
        assert resp.json()['created'] == 1


# ====================================================================
# LEVEL E: BATCH CONVERT WITH FEE GENERATION
# ====================================================================

class TestBatchConvertWithFees:
    """Test admissions batch-convert with auto fee generation."""

    @pytest.fixture
    def confirmed_enquiries(self, seed_data, api):
        """Create two CONFIRMED enquiries (simplified admissions — no session needed)."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        enq_ids = []
        for i, child_name in enumerate(['FeeChild1', 'FeeChild2']):
            resp = api.post('/api/admissions/enquiries/', {
                'name': f'{prefix}{child_name}',
                'father_name': f'{prefix}FeeParent{i}',
                'mobile': f'030{i}1111111',
                'applying_for_grade_level': '1',
                'source': 'WALK_IN',
            }, token, sid)
            assert resp.status_code == 201, f"Setup enquiry {i}: {resp.status_code} {resp.content[:200]}"
            enq_id = resp.json()['id']

            # Confirm the enquiry
            resp2 = api.patch(f'/api/admissions/enquiries/{enq_id}/update-status/', {
                'status': 'CONFIRMED',
            }, token, sid)
            assert resp2.status_code == 200, f"Setup confirm {i}: {resp2.status_code} {resp2.content[:200]}"

            enq_ids.append(enq_id)

        return enq_ids

    def test_batch_convert_without_fees(self, seed_data, api, confirmed_enquiries):
        """E1 - Batch convert without generate_fees — no fee records created."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        ay = seed_data['academic_year']

        resp = api.post('/api/admissions/enquiries/batch-convert/', {
            'enquiry_ids': [confirmed_enquiries[0]],
            'academic_year_id': ay.id,
            'class_id': class_1.id,
            'generate_fees': False,
        }, token, sid)

        assert resp.status_code == 201, f"E1 Convert: {resp.status_code} {resp.content[:300]}"
        data = resp.json()
        assert data.get('fees_generated_count', 0) == 0, "E1 Expected no fees generated"

    def test_batch_convert_with_fee_generation(self, seed_data, api, confirmed_enquiries, fee_structures):
        """E2 - Batch convert with generate_fees=True creates fee records."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        ay = seed_data['academic_year']

        resp = api.post('/api/admissions/enquiries/batch-convert/', {
            'enquiry_ids': [confirmed_enquiries[1]],
            'academic_year_id': ay.id,
            'class_id': class_1.id,
            'generate_fees': True,
            'fee_types': ['ADMISSION', 'ANNUAL'],
        }, token, sid)

        assert resp.status_code == 201, f"E2 Convert with fees: {resp.status_code} {resp.content[:300]}"
        data = resp.json()
        assert data.get('fees_generated_count', 0) >= 2, \
            f"E2 Expected >=2 fees (ADMISSION + ANNUAL), got {data.get('fees_generated_count', 0)}"

    def test_batch_convert_fee_types_required_when_generate(self, seed_data, api):
        """E3 - generate_fees=True without fee_types should be rejected."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        ay = seed_data['academic_year']

        resp = api.post('/api/admissions/enquiries/batch-convert/', {
            'enquiry_ids': [99999],
            'academic_year_id': ay.id,
            'class_id': class_1.id,
            'generate_fees': True,
            'fee_types': [],
        }, token, sid)

        assert resp.status_code == 400, f"E3 Expected 400: {resp.status_code}"


# ====================================================================
# LEVEL F: MONTHLY SUMMARY WITH FEE_TYPE FILTER
# ====================================================================

class TestMonthlySummaryFeeType:
    """Test /api/finance/fee-payments/monthly_summary/ with fee_type filter."""

    def test_summary_for_monthly(self, seed_data, api):
        """F1 - Monthly summary with fee_type=MONTHLY."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/finance/fee-payments/monthly_summary/?month=2&year=2026&fee_type=MONTHLY', token, sid)
        assert resp.status_code == 200, f"F1 Summary MONTHLY: {resp.status_code}"

    def test_summary_for_annual(self, seed_data, api):
        """F2 - Monthly summary with fee_type=ANNUAL and month=0."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/finance/fee-payments/monthly_summary/?month=0&year=2026&fee_type=ANNUAL', token, sid)
        assert resp.status_code == 200, f"F2 Summary ANNUAL: {resp.status_code}"

    def test_summary_for_admission(self, seed_data, api):
        """F3 - Monthly summary with fee_type=ADMISSION."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/finance/fee-payments/monthly_summary/?month=0&year=2026&fee_type=ADMISSION', token, sid)
        assert resp.status_code == 200, f"F3 Summary ADMISSION: {resp.status_code}"


# ====================================================================
# LEVEL G: BULK FEE STRUCTURE WITH FEE_TYPE
# ====================================================================

class TestBulkFeeStructure:
    """Test POST /api/finance/fee-structures/bulk_set/ with fee_type."""

    def test_bulk_set_annual(self, seed_data, api):
        """G1 - Bulk set fee structures with ANNUAL fee_type."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_2 = seed_data['classes'][1]
        class_3 = seed_data['classes'][2]
        ay = seed_data['academic_year']

        resp = api.post('/api/finance/fee-structures/bulk_set/', {
            'academic_year': ay.id,
            'effective_from': str(date.today()),
            'structures': [
                {'class_obj': class_2.id, 'monthly_amount': '12000', 'fee_type': 'ANNUAL'},
                {'class_obj': class_3.id, 'monthly_amount': '14000', 'fee_type': 'ANNUAL'},
            ],
        }, token, sid)

        assert resp.status_code in (200, 201), f"G1 Bulk set ANNUAL: {resp.status_code} {resp.content[:300]}"

    def test_bulk_set_does_not_affect_other_types(self, seed_data, api, fee_structures):
        """G2 - Bulk setting ANNUAL should not deactivate MONTHLY structures."""
        from finance.models import FeeStructure
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        ay = seed_data['academic_year']

        # Bulk set ANNUAL
        api.post('/api/finance/fee-structures/bulk_set/', {
            'academic_year': ay.id,
            'effective_from': str(date.today()),
            'structures': [
                {'class_obj': class_1.id, 'monthly_amount': '20000', 'fee_type': 'ANNUAL'},
            ],
        }, token, sid)

        # Verify MONTHLY is still active
        monthly_active = FeeStructure.objects.filter(
            school=seed_data['school_a'],
            class_obj=class_1,
            student__isnull=True,
            fee_type='MONTHLY',
            is_active=True,
        ).exists()
        assert monthly_active, "G2 MONTHLY structure was deactivated by ANNUAL bulk_set"


# ====================================================================
# LEVEL H: PERMISSIONS & SCHOOL ISOLATION
# ====================================================================

class TestFeeTypePermissions:
    """Permissions and multi-tenant isolation for fee types."""

    def test_teacher_cannot_create_fee_structure(self, seed_data, api):
        """H1 - Teacher cannot create fee structures (403)."""
        token = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/finance/fee-structures/', {
            'class_obj': class_1.id,
            'fee_type': 'ANNUAL',
            'monthly_amount': '15000.00',
            'effective_from': str(date.today()),
        }, token, sid)

        assert resp.status_code == 403, f"H1 Teacher create: {resp.status_code}"

    def test_school_b_cannot_see_school_a_payments(self, seed_data, api):
        """H2 - School B admin cannot see School A fee payments."""
        token_a = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        token_b = seed_data['tokens']['admin_b']
        sid_b = seed_data['SID_B']
        student = seed_data['students'][0]

        # Create a payment in School A
        api.post('/api/finance/fee-payments/', {
            'school': sid_a,
            'student': student.id, 'fee_type': 'ADMISSION',
            'month': 0, 'year': 2025, 'amount_due': '10000', 'amount_paid': '0',
        }, token_a, sid_a)

        # School B should see none
        resp = api.get('/api/finance/fee-payments/?fee_type=ADMISSION&year=2025&month=0', token_b, sid_b)
        data = _results(resp)

        assert resp.status_code == 200
        assert len(data) == 0, f"H2 School B isolation: expected 0, got {len(data)}"

    def test_accountant_has_read_only_access(self, seed_data, api):
        """H3 - Accountant (staff-level) gets read-only access to finance data."""
        token = seed_data['tokens']['accountant']
        sid = seed_data['SID_A']
        student = seed_data['students'][8]

        # Accountant can READ fee payments
        resp_get = api.get('/api/finance/fee-payments/?year=2026', token, sid)
        assert resp_get.status_code == 200, f"H3 Accountant read: {resp_get.status_code}"

        # Accountant CANNOT create fee payments (staff = read-only)
        resp_post = api.post('/api/finance/fee-payments/', {
            'school': sid,
            'student': student.id,
            'fee_type': 'FINE',
            'month': 0,
            'year': 2026,
            'amount_due': '500.00',
            'amount_paid': '0.00',
        }, token, sid)

        assert resp_post.status_code == 403, f"H3 Accountant create: {resp_post.status_code} {resp_post.content[:300]}"

    def test_unauthenticated_rejected(self, seed_data, api):
        """H4 - Unauthenticated request to fee endpoints returns 401."""
        resp = api.client.get('/api/finance/fee-payments/')
        assert resp.status_code == 401, f"H4 Unauth: {resp.status_code}"
