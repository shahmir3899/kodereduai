# -*- coding: utf-8 -*-
"""
Phase 4 Pytest Suite -- Academics & Timetable Module
=====================================================

Converted from the Django-shell script test_phase4_academics.py into proper
pytest format.  All seed data comes from the ``seed_data`` / ``api`` fixtures
defined in ``conftest.py``.

Markers:
    @pytest.mark.django_db   -- every test touches the DB
    @pytest.mark.phase4      -- select with ``pytest -m phase4``

Test groups:
    TestSubjectsAPI            -- Level A  (CRUD, validation, search, permissions, isolation)
    TestTimetableSlots         -- Level B  (CRUD, validation, ordering, permissions)
    TestClassSubjectAssignments-- Level C  (CRUD, filters, teacher linkage, auto-AY)
    TestTimetableEntries       -- Level D  (CRUD, bulk_save, by_class grid, teacher conflicts)
    TestAIFeatures             -- Level E  (auto_generate, quality_score, suggest_resolution, etc.)
    TestAIChat                 -- Level F  (send, history, clear)
    TestCrossCutting           -- Level G  (unauth, invalid token, school isolation, data integrity)
"""

import pytest
from datetime import date

from academics.models import Subject, ClassSubject, TimetableSlot, TimetableEntry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_subject_id(school, code):
    obj = Subject.objects.filter(school=school, code=code.upper()).first()
    return obj.id if obj else None


def _get_slot_id(school, order):
    obj = TimetableSlot.objects.filter(school=school, order=order).first()
    return obj.id if obj else None


def _get_cs_id(school, class_obj_id, subject_id):
    obj = ClassSubject.objects.filter(
        school=school, class_obj_id=class_obj_id, subject_id=subject_id, is_active=True,
    ).first()
    return obj.id if obj else None


def _get_entry_id(school, class_obj_id, day, slot_id):
    obj = TimetableEntry.objects.filter(
        school=school, class_obj_id=class_obj_id, day=day, slot_id=slot_id,
    ).first()
    return obj.id if obj else None


# ---------------------------------------------------------------------------
# Level A: Subjects API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestSubjectsAPI:
    """Level A -- Subjects CRUD, validation, search, permissions, isolation."""

    def test_a1_create_subject_as_admin(self, seed_data, api):
        """A1: Admin can create a subject."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/subjects/', {
            'name': f'{prefix}Mathematics',
            'code': 'math',
            'description': 'Core math subject',
            'is_elective': False,
        }, token, SID_A)
        assert resp.status_code == 201, f"A1 Create subject (Admin) status={resp.status_code}"

    def test_a2_create_subject_as_principal(self, seed_data, api):
        """A2: Principal can create a subject."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['principal']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/subjects/', {
            'name': f'{prefix}English',
            'code': 'eng',
            'description': 'English language',
            'is_elective': False,
        }, token, SID_A)
        assert resp.status_code == 201, f"A2 Create subject (Principal) status={resp.status_code}"

    def test_a3_create_subject_as_teacher_forbidden(self, seed_data, api):
        """A3: Teacher cannot create a subject (403)."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/subjects/', {
            'name': f'{prefix}Physics',
            'code': 'phy',
        }, token, SID_A)
        assert resp.status_code == 403, f"A3 Teacher create -> 403, got {resp.status_code}"

    def test_a4_duplicate_code_rejected(self, seed_data, api):
        """A4: Duplicate subject code returns 400."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create the original first
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}Mathematics',
            'code': 'math_dup',
            'is_elective': False,
        }, token, SID_A)

        resp = api.post('/api/academics/subjects/', {
            'name': f'{prefix}Math 2',
            'code': 'MATH_DUP',
        }, token, SID_A)
        assert resp.status_code == 400, f"A4 Duplicate code -> 400, got {resp.status_code}"

    def test_a5_missing_required_fields_rejected(self, seed_data, api):
        """A5: Missing name/code returns 400."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/subjects/', {
            'description': 'no name or code',
        }, token, SID_A)
        assert resp.status_code == 400, f"A5 Missing fields -> 400, got {resp.status_code}"

    def test_a6_list_subjects(self, seed_data, api):
        """A6: List subjects returns created test subjects."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create subjects
        for name, code in [('Mathematics', 'math_a6'), ('English', 'eng_a6'),
                           ('Science', 'sci_a6'), ('Art', 'art_a6')]:
            api.post('/api/academics/subjects/', {
                'name': f'{prefix}{name}',
                'code': code,
                'is_elective': (name == 'Art'),
            }, token, SID_A)

        resp = api.get('/api/academics/subjects/', token, SID_A)
        assert resp.status_code == 200, f"A6 List status={resp.status_code}"
        subjects = resp.json()
        test_subjects = [s for s in subjects if s.get('name', '').startswith(prefix)]
        assert len(test_subjects) >= 4, f"A6 Expected >=4 test subjects, got {len(test_subjects)}"

    def test_a7_search_by_name(self, seed_data, api):
        """A7: Search subjects by name."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create a subject to search for
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathSearch',
            'code': 'math_a7',
        }, token, SID_A)

        resp = api.get(f'/api/academics/subjects/?search={prefix}MathSearch', token, SID_A)
        assert resp.status_code == 200, f"A7 Search status={resp.status_code}"
        results = resp.json()
        assert len(results) >= 1, f"A7 Expected >=1 result, got {len(results)}"

    def test_a8_filter_elective(self, seed_data, api):
        """A8: Filter elective subjects."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create an elective subject
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}Art_A8',
            'code': 'art_a8',
            'is_elective': True,
        }, token, SID_A)

        resp = api.get('/api/academics/subjects/?is_elective=true', token, SID_A)
        assert resp.status_code == 200, f"A8 Filter status={resp.status_code}"
        results = resp.json()
        test_electives = [s for s in results if s.get('name', '').startswith(prefix)]
        assert len(test_electives) >= 1, f"A8 Expected >=1 elective, got {len(test_electives)}"

    def test_a9_retrieve_single_subject(self, seed_data, api):
        """A9: Retrieve a single subject by ID."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathRetrieve',
            'code': 'math_a9',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_A9')
        assert subj_id is not None, "A9 Subject not created"

        resp = api.get(f'/api/academics/subjects/{subj_id}/', token, SID_A)
        assert resp.status_code == 200, f"A9 Retrieve status={resp.status_code}"
        assert resp.json().get('code') == 'MATH_A9', "A9 Code mismatch"

    def test_a10_update_subject_as_admin(self, seed_data, api):
        """A10: Admin can update a subject."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathUpdate',
            'code': 'math_a10',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_A10')
        assert subj_id is not None, "A10 Subject not created"

        resp = api.patch(f'/api/academics/subjects/{subj_id}/', {
            'description': 'Updated math description',
        }, token, SID_A)
        assert resp.status_code == 200, f"A10 Update status={resp.status_code}"

    def test_a11_update_subject_as_principal(self, seed_data, api):
        """A11: Principal can update a subject."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_principal = seed_data['tokens']['principal']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}EngUpdate',
            'code': 'eng_a11',
        }, token_admin, SID_A)
        subj_id = _get_subject_id(school_a, 'ENG_A11')
        assert subj_id is not None, "A11 Subject not created"

        resp = api.patch(f'/api/academics/subjects/{subj_id}/', {
            'description': 'Updated english description',
        }, token_principal, SID_A)
        assert resp.status_code == 200, f"A11 Update principal status={resp.status_code}"

    def test_a12_soft_delete_subject(self, seed_data, api):
        """A12: Soft-delete sets is_active=False."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}ArtDelete',
            'code': 'art_a12',
            'is_elective': True,
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'ART_A12')
        assert subj_id is not None, "A12 Subject not created"

        resp = api.delete(f'/api/academics/subjects/{subj_id}/', token, SID_A)
        assert resp.status_code in (200, 204), f"A12 Delete status={resp.status_code}"

        art_obj = Subject.objects.filter(id=subj_id).first()
        assert art_obj is not None, "A12 Subject row should still exist"
        assert art_obj.is_active is False, f"A12 is_active should be False, got {art_obj.is_active}"

    def test_a13_code_auto_uppercased(self, seed_data, api):
        """A13: Subject code is auto-uppercased."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathUpper',
            'code': 'math_a13',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_A13')
        assert subj_id is not None, "A13 Subject not created"

        resp = api.get(f'/api/academics/subjects/{subj_id}/', token, SID_A)
        assert resp.status_code == 200, f"A13 Retrieve status={resp.status_code}"
        code = resp.json().get('code', '')
        assert code == 'MATH_A13', f"A13 Expected 'MATH_A13', got '{code}'"

    def test_a14_school_b_isolation(self, seed_data, api):
        """A14: School B cannot see School A subjects."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_admin_b = seed_data['tokens']['admin_b']
        SID_A = seed_data['SID_A']
        SID_B = seed_data['SID_B']

        # Create a subject in School A
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}Isolated',
            'code': 'iso_a14',
        }, token_admin, SID_A)

        resp = api.get('/api/academics/subjects/', token_admin_b, SID_B)
        assert resp.status_code == 200, f"A14 status={resp.status_code}"
        results = resp.json()
        test_b = [s for s in results if s.get('name', '').startswith(prefix)]
        assert len(test_b) == 0, f"A14 School B saw {len(test_b)} test subjects from A"


# ---------------------------------------------------------------------------
# Level B: Timetable Slots API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestTimetableSlots:
    """Level B -- Timetable Slots CRUD, validation, ordering, permissions."""

    def test_b1_create_period_slot_as_admin(self, seed_data, api):
        """B1: Admin can create a PERIOD slot."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Period 1',
            'slot_type': 'PERIOD',
            'start_time': '08:00',
            'end_time': '08:45',
            'order': 901,
        }, token, SID_A)
        assert resp.status_code == 201, f"B1 Create PERIOD slot status={resp.status_code}"

    def test_b2_create_break_slot_as_principal(self, seed_data, api):
        """B2: Principal can create a BREAK slot."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['principal']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Break',
            'slot_type': 'BREAK',
            'start_time': '08:45',
            'end_time': '09:00',
            'order': 902,
        }, token, SID_A)
        assert resp.status_code == 201, f"B2 Create BREAK slot status={resp.status_code}"

    def test_b3_create_lunch_slot(self, seed_data, api):
        """B3: Admin can create a LUNCH slot."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Lunch',
            'slot_type': 'LUNCH',
            'start_time': '12:00',
            'end_time': '12:30',
            'order': 906,
        }, token, SID_A)
        assert resp.status_code == 201, f"B3 Create LUNCH slot status={resp.status_code}"

    def test_b4_create_assembly_slot(self, seed_data, api):
        """B4: Admin can create an ASSEMBLY slot."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Assembly',
            'slot_type': 'ASSEMBLY',
            'start_time': '07:45',
            'end_time': '08:00',
            'order': 900,
        }, token, SID_A)
        assert resp.status_code == 201, f"B4 Create ASSEMBLY slot status={resp.status_code}"

    def test_b5_create_slot_as_teacher_forbidden(self, seed_data, api):
        """B5: Teacher cannot create a slot (403)."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Illegal',
            'slot_type': 'PERIOD',
            'start_time': '14:00',
            'end_time': '14:45',
            'order': 999,
        }, token, SID_A)
        assert resp.status_code == 403, f"B5 Teacher create slot -> 403, got {resp.status_code}"

    def test_b6_duplicate_order_rejected(self, seed_data, api):
        """B6: Duplicate order for same school returns 400."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create the first slot
        api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Period B6',
            'slot_type': 'PERIOD',
            'start_time': '08:00',
            'end_time': '08:45',
            'order': 801,
        }, token, SID_A)

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Duplicate Order',
            'slot_type': 'PERIOD',
            'start_time': '09:00',
            'end_time': '09:45',
            'order': 801,
        }, token, SID_A)
        assert resp.status_code == 400, f"B6 Duplicate order -> 400, got {resp.status_code}"

    def test_b7_end_time_before_start_time_rejected(self, seed_data, api):
        """B7: end_time <= start_time returns 400."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}BadTimes',
            'slot_type': 'PERIOD',
            'start_time': '10:00',
            'end_time': '09:00',
            'order': 950,
        }, token, SID_A)
        assert resp.status_code == 400, f"B7 end_time <= start_time -> 400, got {resp.status_code}"

    def test_b8_list_slots_ordered(self, seed_data, api):
        """B8: List slots returns them ordered by the 'order' field."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create several slots with known orders
        for order, name, start, end in [
            (810, 'SlotB8_1', '08:00', '08:45'),
            (812, 'SlotB8_2', '09:00', '09:45'),
            (811, 'SlotB8_3', '08:45', '09:00'),
        ]:
            api.post('/api/academics/timetable-slots/', {
                'name': f'{prefix}{name}',
                'slot_type': 'PERIOD',
                'start_time': start,
                'end_time': end,
                'order': order,
            }, token, SID_A)

        resp = api.get('/api/academics/timetable-slots/', token, SID_A)
        assert resp.status_code == 200, f"B8 List status={resp.status_code}"
        slots = resp.json()
        test_slots = [s for s in slots if s.get('name', '').startswith(prefix)]
        orders = [s['order'] for s in test_slots]
        assert orders == sorted(orders), f"B8 Slots not ordered: {orders}"

    def test_b9_update_slot(self, seed_data, api):
        """B9: Admin can update a slot name."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Period B9',
            'slot_type': 'PERIOD',
            'start_time': '08:00',
            'end_time': '08:45',
            'order': 820,
        }, token, SID_A)
        slot_id = _get_slot_id(school_a, 820)
        assert slot_id is not None, "B9 Slot not created"

        resp = api.patch(f'/api/academics/timetable-slots/{slot_id}/', {
            'name': f'{prefix}Period B9 Updated',
        }, token, SID_A)
        assert resp.status_code == 200, f"B9 Update status={resp.status_code}"

    def test_b10_soft_delete_slot(self, seed_data, api):
        """B10: Soft-delete sets is_active=False on the slot."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Assembly B10',
            'slot_type': 'ASSEMBLY',
            'start_time': '07:45',
            'end_time': '08:00',
            'order': 830,
        }, token, SID_A)
        slot_id = _get_slot_id(school_a, 830)
        assert slot_id is not None, "B10 Slot not created"

        resp = api.delete(f'/api/academics/timetable-slots/{slot_id}/', token, SID_A)
        assert resp.status_code in (200, 204), f"B10 Delete status={resp.status_code}"

        slot_obj = TimetableSlot.objects.filter(id=slot_id).first()
        assert slot_obj is not None, "B10 Slot row should still exist"
        assert slot_obj.is_active is False, f"B10 is_active should be False, got {slot_obj.is_active}"

    def test_b11_school_b_isolation(self, seed_data, api):
        """B11: School B cannot see School A slots."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_admin_b = seed_data['tokens']['admin_b']
        SID_A = seed_data['SID_A']
        SID_B = seed_data['SID_B']

        # Create a slot in School A
        api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}Isolated B11',
            'slot_type': 'PERIOD',
            'start_time': '08:00',
            'end_time': '08:45',
            'order': 840,
        }, token_admin, SID_A)

        resp = api.get('/api/academics/timetable-slots/', token_admin_b, SID_B)
        assert resp.status_code == 200, f"B11 status={resp.status_code}"
        results = resp.json()
        test_b_slots = [s for s in results if s.get('name', '').startswith(prefix)]
        assert len(test_b_slots) == 0, f"B11 School B saw {len(test_b_slots)} test slots from A"


# ---------------------------------------------------------------------------
# Level C: Class-Subject Assignments API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestClassSubjectAssignments:
    """Level C -- Class-Subject assignment CRUD, filters, teacher linkage, auto-AY."""

    def _setup_subjects(self, seed_data, api):
        """Create subjects needed for class-subject tests; return their IDs."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        subjects = {}
        for name, code in [('Math', 'math_c'), ('English', 'eng_c'), ('Science', 'sci_c')]:
            api.post('/api/academics/subjects/', {
                'name': f'{prefix}{name}_CS',
                'code': code,
                'is_elective': False,
            }, token, SID_A)
            subjects[name.lower()] = _get_subject_id(school_a, code.upper())
        return subjects

    def test_c1_assign_subject_without_teacher_as_admin(self, seed_data, api):
        """C1: Admin assigns a subject to a class without specifying teacher."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        subjects = self._setup_subjects(seed_data, api)
        subj_math_id = subjects['math']
        assert subj_math_id is not None, "C1 Math subject not created"

        resp = api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_math_id,
            'periods_per_week': 5,
        }, token, SID_A)
        assert resp.status_code == 201, f"C1 Assign without teacher status={resp.status_code}"

    def test_c2_assign_subject_with_teacher_as_principal(self, seed_data, api):
        """C2: Principal assigns a subject with a teacher."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_principal = seed_data['tokens']['principal']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_1 = seed_data['staff'][0]

        # Create a unique subject for this test
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}EngC2',
            'code': 'eng_c2',
            'is_elective': False,
        }, token_admin, SID_A)
        subj_eng_id = _get_subject_id(school_a, 'ENG_C2')
        assert subj_eng_id is not None, "C2 English subject not created"

        resp = api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_eng_id,
            'teacher': staff_1.id,
            'periods_per_week': 4,
        }, token_principal, SID_A)
        assert resp.status_code == 201, f"C2 Assign with teacher status={resp.status_code}"

    def test_c3_assign_subject_as_teacher_forbidden(self, seed_data, api):
        """C3: Teacher cannot assign subjects (403)."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_teacher = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_2 = seed_data['classes'][1]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC3',
            'code': 'math_c3',
        }, token_admin, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C3')

        resp = api.post('/api/academics/class-subjects/', {
            'class_obj': class_2.id,
            'subject': subj_id,
        }, token_teacher, SID_A)
        assert resp.status_code == 403, f"C3 Teacher assign -> 403, got {resp.status_code}"

    def test_c4_duplicate_assignment_rejected(self, seed_data, api):
        """C4: Duplicate class+subject assignment returns 400."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC4',
            'code': 'math_c4',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C4')

        # First assignment
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
        }, token, SID_A)

        # Duplicate
        resp = api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
        }, token, SID_A)
        assert resp.status_code == 400, f"C4 Duplicate assignment -> 400, got {resp.status_code}"

    def test_c5_set_periods_per_week(self, seed_data, api):
        """C5: periods_per_week value is persisted."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_2 = seed_data['staff'][1]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}SciC5',
            'code': 'sci_c5',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'SCI_C5')
        assert subj_id is not None, "C5 Science subject not created"

        resp = api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
            'teacher': staff_2.id,
            'periods_per_week': 3,
        }, token, SID_A)
        assert resp.status_code == 201, f"C5 Create status={resp.status_code}"

        cs_id = _get_cs_id(school_a, class_1.id, subj_id)
        assert cs_id is not None, "C5 ClassSubject not created"
        cs_obj = ClassSubject.objects.get(id=cs_id)
        assert cs_obj.periods_per_week == 3, f"C5 periods_per_week={cs_obj.periods_per_week}, expected 3"

    def test_c6_list_assignments_computed_fields(self, seed_data, api):
        """C6: List assignments includes computed fields (class_name, subject_name, teacher_name)."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_1 = seed_data['staff'][0]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC6',
            'code': 'math_c6',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C6')

        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
            'teacher': staff_1.id,
        }, token, SID_A)

        resp = api.get('/api/academics/class-subjects/', token, SID_A)
        assert resp.status_code == 200, f"C6 List status={resp.status_code}"
        assignments = resp.json()
        test_assignments = [a for a in assignments if a.get('class_name', '').startswith(prefix)]
        assert len(test_assignments) >= 1, f"C6 Expected >=1 test assignment"

        a = test_assignments[0]
        assert 'class_name' in a, "C6 Missing class_name"
        assert 'subject_name' in a, "C6 Missing subject_name"
        assert 'teacher_name' in a, "C6 Missing teacher_name"

    def test_c7_filter_by_class(self, seed_data, api):
        """C7: Filter class-subjects by class_obj."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        # Create several subjects and assign them to class_1
        for code in ['c7a', 'c7b', 'c7c']:
            api.post('/api/academics/subjects/', {
                'name': f'{prefix}Subj_{code}',
                'code': code,
            }, token, SID_A)
            subj_id = _get_subject_id(school_a, code.upper())
            api.post('/api/academics/class-subjects/', {
                'class_obj': class_1.id,
                'subject': subj_id,
            }, token, SID_A)

        resp = api.get(f'/api/academics/class-subjects/?class_obj={class_1.id}', token, SID_A)
        assert resp.status_code == 200, f"C7 Filter status={resp.status_code}"
        results = resp.json()
        assert len(results) >= 3, f"C7 Expected >=3 filtered results, got {len(results)}"

    def test_c8_by_class_action(self, seed_data, api):
        """C8: by_class action returns assignments for given class_id."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        # Create subject and assign
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}SubjC8',
            'code': 'c8_subj',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'C8_SUBJ')
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
        }, token, SID_A)

        resp = api.get(
            f'/api/academics/class-subjects/by_class/?class_id={class_1.id}', token, SID_A,
        )
        assert resp.status_code == 200, f"C8 by_class status={resp.status_code}"
        results = resp.json()
        assert len(results) >= 1, f"C8 Expected >=1 result, got {len(results)}"

    def test_c9_update_teacher_assignment(self, seed_data, api):
        """C9: Admin can update the teacher on an assignment."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_3 = seed_data['staff'][2]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC9',
            'code': 'math_c9',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C9')
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
            'periods_per_week': 5,
        }, token, SID_A)
        cs_id = _get_cs_id(school_a, class_1.id, subj_id)
        assert cs_id is not None, "C9 ClassSubject not created"

        resp = api.patch(f'/api/academics/class-subjects/{cs_id}/', {
            'teacher': staff_3.id,
        }, token, SID_A)
        assert resp.status_code == 200, f"C9 Update teacher status={resp.status_code}"

    def test_c10_update_periods_per_week(self, seed_data, api):
        """C10: Admin can update periods_per_week."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC10',
            'code': 'math_c10',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C10')
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
            'periods_per_week': 5,
        }, token, SID_A)
        cs_id = _get_cs_id(school_a, class_1.id, subj_id)
        assert cs_id is not None, "C10 ClassSubject not created"

        resp = api.patch(f'/api/academics/class-subjects/{cs_id}/', {
            'periods_per_week': 6,
        }, token, SID_A)
        assert resp.status_code == 200, f"C10 Update periods_per_week status={resp.status_code}"

    def test_c11_soft_delete_assignment(self, seed_data, api):
        """C11: Soft-delete sets is_active=False on a class-subject."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_3 = seed_data['classes'][2]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC11',
            'code': 'math_c11',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C11')

        api.post('/api/academics/class-subjects/', {
            'class_obj': class_3.id,
            'subject': subj_id,
        }, token, SID_A)
        cs_id = _get_cs_id(school_a, class_3.id, subj_id)
        assert cs_id is not None, "C11 ClassSubject not created"

        resp = api.delete(f'/api/academics/class-subjects/{cs_id}/', token, SID_A)
        assert resp.status_code in (200, 204), f"C11 Delete status={resp.status_code}"

        cs_obj = ClassSubject.objects.filter(id=cs_id).first()
        assert cs_obj is not None, "C11 ClassSubject row should still exist"
        assert cs_obj.is_active is False, f"C11 is_active should be False, got {cs_obj.is_active}"

    def test_c12_auto_resolves_academic_year(self, seed_data, api):
        """C12: ClassSubject auto-resolves to current academic year."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        academic_year = seed_data['academic_year']

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathC12',
            'code': 'math_c12',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_C12')
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
        }, token, SID_A)
        cs_id = _get_cs_id(school_a, class_1.id, subj_id)
        assert cs_id is not None, "C12 ClassSubject not created"

        cs_obj = ClassSubject.objects.get(id=cs_id)
        assert cs_obj.academic_year_id == academic_year.id, (
            f"C12 ay_id={cs_obj.academic_year_id} expected={academic_year.id}"
        )

    def test_c13_school_b_isolation(self, seed_data, api):
        """C13: School B cannot see School A class-subject assignments."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_admin_b = seed_data['tokens']['admin_b']
        SID_A = seed_data['SID_A']
        SID_B = seed_data['SID_B']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        # Create an assignment in School A
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}IsoC13',
            'code': 'iso_c13',
        }, token_admin, SID_A)
        subj_id = _get_subject_id(school_a, 'ISO_C13')
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
        }, token_admin, SID_A)

        resp = api.get('/api/academics/class-subjects/', token_admin_b, SID_B)
        assert resp.status_code == 200, f"C13 status={resp.status_code}"
        results = resp.json()
        test_b_cs = [c for c in results if c.get('class_name', '').startswith(prefix)]
        assert len(test_b_cs) == 0, f"C13 School B saw {len(test_b_cs)} assignments from A"


# ---------------------------------------------------------------------------
# Level D: Timetable Entries API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestTimetableEntries:
    """Level D -- Timetable entry CRUD, bulk_save, by_class grid, teacher conflicts."""

    def _setup_slots_and_subjects(self, seed_data, api, code_suffix='d'):
        """Create slots + subjects needed for timetable entry tests."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        # Slots
        slot_orders = {
            'p1': (701, '08:00', '08:45'),
            'p2': (702, '09:00', '09:45'),
            'p3': (703, '09:45', '10:30'),
            'p4': (704, '10:30', '11:15'),
            'brk': (705, '08:45', '09:00'),
        }
        slot_ids = {}
        for key, (order, start, end) in slot_orders.items():
            real_order = order + hash(code_suffix) % 100  # unique per call
            slot_type = 'BREAK' if key == 'brk' else 'PERIOD'
            api.post('/api/academics/timetable-slots/', {
                'name': f'{prefix}Slot_{key}_{code_suffix}',
                'slot_type': slot_type,
                'start_time': start,
                'end_time': end,
                'order': real_order,
            }, token, SID_A)
            slot_ids[key] = _get_slot_id(school_a, real_order)

        # Subjects
        subj_ids = {}
        for name, code in [('Math', f'math_{code_suffix}'), ('Eng', f'eng_{code_suffix}'),
                           ('Sci', f'sci_{code_suffix}')]:
            api.post('/api/academics/subjects/', {
                'name': f'{prefix}{name}_{code_suffix}',
                'code': code,
            }, token, SID_A)
            subj_ids[name.lower()] = _get_subject_id(school_a, code.upper())

        return slot_ids, subj_ids

    def test_d1_create_single_entry_as_admin(self, seed_data, api):
        """D1: Admin can create a single timetable entry."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd1')

        resp = api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
            'room': 'Room 101',
        }, token, SID_A)
        assert resp.status_code == 201, f"D1 Create entry status={resp.status_code}"

    def test_d2_create_single_entry_as_principal(self, seed_data, api):
        """D2: Principal can create a single timetable entry."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_principal = seed_data['tokens']['principal']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_1 = seed_data['staff'][0]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd2')

        resp = api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p2'],
            'subject': subj_ids['eng'],
            'teacher': staff_1.id,
        }, token_principal, SID_A)
        assert resp.status_code == 201, f"D2 Create entry (Principal) status={resp.status_code}"

    def test_d3_create_entry_as_teacher_forbidden(self, seed_data, api):
        """D3: Teacher cannot create entries (403)."""
        prefix = seed_data['prefix']
        token_teacher = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd3')
        class_1 = seed_data['classes'][0]

        resp = api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p3'],
            'subject': subj_ids['sci'],
        }, token_teacher, SID_A)
        assert resp.status_code == 403, f"D3 Teacher create entry -> 403, got {resp.status_code}"

    def test_d4_duplicate_class_day_slot_rejected(self, seed_data, api):
        """D4: Duplicate class+day+slot returns 400."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd4')

        # First entry
        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
        }, token, SID_A)

        # Duplicate
        resp = api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['eng'],
        }, token, SID_A)
        assert resp.status_code == 400, f"D4 Duplicate class+day+slot -> 400, got {resp.status_code}"

    def test_d5_teacher_conflict_rejected(self, seed_data, api):
        """D5: Same teacher at same day+slot in different class returns 400."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd5')

        # Staff 3 in class_1 MON slot_p1
        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
        }, token, SID_A)

        # Same teacher, same slot, different class -> conflict
        resp = api.post('/api/academics/timetable-entries/', {
            'class_obj': class_2.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
        }, token, SID_A)
        assert resp.status_code == 400, f"D5 Teacher conflict -> 400, got {resp.status_code}"

    def test_d6_by_class_grid_structure(self, seed_data, api):
        """D6: by_class returns grid structure with 'grid' and 'entries' keys."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd6')

        # Create an entry so there is data
        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
        }, token, SID_A)

        resp = api.get(
            f'/api/academics/timetable-entries/by_class/?class_id={class_1.id}', token, SID_A,
        )
        assert resp.status_code == 200, f"D6 by_class status={resp.status_code}"
        data = resp.json()
        assert 'grid' in data and 'entries' in data, f"D6 Missing keys, got {list(data.keys())}"

    def test_d7_bulk_save_entries(self, seed_data, api):
        """D7: Bulk save creates multiple entries at once."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        staff_1 = seed_data['staff'][0]
        staff_2 = seed_data['staff'][1]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd7')

        resp = api.post('/api/academics/timetable-entries/bulk_save/', {
            'class_obj': class_1.id,
            'day': 'TUE',
            'entries': [
                {'slot': slot_ids['p1'], 'subject': subj_ids['eng'], 'teacher': staff_1.id, 'room': 'R1'},
                {'slot': slot_ids['p2'], 'subject': subj_ids['math'], 'teacher': staff_3.id, 'room': 'R2'},
                {'slot': slot_ids['p3'], 'subject': subj_ids['sci'], 'teacher': staff_2.id, 'room': 'R3'},
            ],
        }, token, SID_A)
        assert resp.status_code == 200, f"D7 Bulk save status={resp.status_code}"
        assert resp.json().get('created') == 3, f"D7 created={resp.json().get('created')}, expected 3"

    def test_d8_bulk_save_overwrites_existing(self, seed_data, api):
        """D8: Bulk save for same class+day replaces all existing entries."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_1 = seed_data['staff'][0]
        staff_2 = seed_data['staff'][1]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd8')

        # Initial bulk save (3 entries)
        api.post('/api/academics/timetable-entries/bulk_save/', {
            'class_obj': class_1.id,
            'day': 'TUE',
            'entries': [
                {'slot': slot_ids['p1'], 'subject': subj_ids['eng'], 'teacher': staff_1.id},
                {'slot': slot_ids['p2'], 'subject': subj_ids['math'], 'teacher': staff_2.id},
            ],
        }, token, SID_A)

        # Overwrite with just 1 entry
        resp = api.post('/api/academics/timetable-entries/bulk_save/', {
            'class_obj': class_1.id,
            'day': 'TUE',
            'entries': [
                {'slot': slot_ids['p1'], 'subject': subj_ids['sci'], 'teacher': staff_2.id},
            ],
        }, token, SID_A)
        assert resp.status_code == 200, f"D8 Bulk overwrite status={resp.status_code}"
        assert resp.json().get('created') == 1, f"D8 created={resp.json().get('created')}, expected 1"

        # Verify only 1 TUE entry remains for this class with these specific slots
        tue_count = TimetableEntry.objects.filter(
            school=school_a, class_obj=class_1, day='TUE',
            slot_id__in=[slot_ids['p1'], slot_ids['p2']],
        ).count()
        assert tue_count == 1, f"D8 Expected 1 TUE entry, got {tue_count}"

    def test_d9_teacher_conflicts_endpoint_has_conflict(self, seed_data, api):
        """D9: teacher_conflicts endpoint returns has_conflict=True when busy."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd9')

        # Book staff_3 on MON slot p1
        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
        }, token, SID_A)

        resp = api.get(
            f'/api/academics/timetable-entries/teacher_conflicts/'
            f'?teacher={staff_3.id}&day=MON&slot={slot_ids["p1"]}&exclude_class={class_2.id}',
            token, SID_A,
        )
        assert resp.status_code == 200, f"D9 status={resp.status_code}"
        assert resp.json().get('has_conflict') is True, "D9 Expected has_conflict=True"

    def test_d10_no_conflict_when_teacher_is_free(self, seed_data, api):
        """D10: teacher_conflicts returns has_conflict=False when teacher is free."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd10')

        resp = api.get(
            f'/api/academics/timetable-entries/teacher_conflicts/'
            f'?teacher={staff_3.id}&day=WED&slot={slot_ids["p3"]}',
            token, SID_A,
        )
        assert resp.status_code == 200, f"D10 status={resp.status_code}"
        assert resp.json().get('has_conflict') is False, "D10 Expected has_conflict=False"

    def test_d11_entry_has_room(self, seed_data, api):
        """D11: Created entry persists the room field."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd11')

        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
            'room': 'Room 101',
        }, token, SID_A)

        entry_id = _get_entry_id(school_a, class_1.id, 'MON', slot_ids['p1'])
        assert entry_id is not None, "D11 Entry not created"
        obj = TimetableEntry.objects.get(id=entry_id)
        assert obj.room == 'Room 101', f"D11 room='{obj.room}', expected 'Room 101'"

    def test_d12_entry_without_subject_for_break(self, seed_data, api):
        """D12: An entry can be created without a subject (e.g. for break slots)."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd12')

        resp = api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['brk'],
        }, token, SID_A)
        assert resp.status_code == 201, f"D12 Break entry status={resp.status_code}"

    def test_d13_school_b_cannot_see_school_a_timetable(self, seed_data, api):
        """D13: School B admin cannot see School A timetable."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_admin_b = seed_data['tokens']['admin_b']
        SID_A = seed_data['SID_A']
        SID_B = seed_data['SID_B']
        class_1 = seed_data['classes'][0]

        slot_ids, subj_ids = self._setup_slots_and_subjects(seed_data, api, 'd13')

        # Create entry in School A
        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
        }, token_admin, SID_A)

        resp = api.get(
            f'/api/academics/timetable-entries/by_class/?class_id={class_1.id}',
            token_admin_b, SID_B,
        )
        assert resp.status_code == 200, f"D13 status={resp.status_code}"
        entries = resp.json().get('entries', [])
        assert len(entries) == 0, f"D13 School B saw {len(entries)} entries from A"


# ---------------------------------------------------------------------------
# Level E: AI Features API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestAIFeatures:
    """Level E -- auto_generate, quality_score, suggest_resolution, substitute, workload, gap, analytics."""

    def _setup_class_subjects(self, seed_data, api, suffix='e'):
        """Create subjects, slots, and class-subject assignments for AI tests."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        staff_1 = seed_data['staff'][0]
        staff_2 = seed_data['staff'][1]
        staff_3 = seed_data['staff'][2]

        # Subjects
        subj_ids = {}
        for name, code in [('Math', f'math_{suffix}'), ('Eng', f'eng_{suffix}'), ('Sci', f'sci_{suffix}')]:
            api.post('/api/academics/subjects/', {
                'name': f'{prefix}{name}_{suffix}',
                'code': code,
            }, token, SID_A)
            subj_ids[name.lower()] = _get_subject_id(school_a, code.upper())

        # Slots
        slot_ids = {}
        for i, (order, start, end) in enumerate([
            (601, '08:00', '08:45'),
            (602, '09:00', '09:45'),
            (603, '09:45', '10:30'),
            (604, '10:30', '11:15'),
        ], start=1):
            real_order = order + hash(suffix) % 50
            api.post('/api/academics/timetable-slots/', {
                'name': f'{prefix}SlotE{i}_{suffix}',
                'slot_type': 'PERIOD',
                'start_time': start,
                'end_time': end,
                'order': real_order,
            }, token, SID_A)
            slot_ids[f'p{i}'] = _get_slot_id(school_a, real_order)

        # Class-subject assignments
        for cls, subj_key, staff, ppw in [
            (class_1, 'math', staff_3, 5),
            (class_1, 'eng', staff_1, 4),
            (class_1, 'sci', staff_2, 3),
            (class_2, 'math', staff_2, 5),
            (class_2, 'eng', staff_3, 4),
        ]:
            api.post('/api/academics/class-subjects/', {
                'class_obj': cls.id,
                'subject': subj_ids[subj_key],
                'teacher': staff.id,
                'periods_per_week': ppw,
            }, token, SID_A)

        return slot_ids, subj_ids

    def test_e1_auto_generate_timetable(self, seed_data, api):
        """E1: auto_generate returns grid, score, and warnings."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_2 = seed_data['classes'][1]

        self._setup_class_subjects(seed_data, api, 'e1')

        resp = api.post('/api/academics/timetable-entries/auto_generate/', {
            'class_id': class_2.id,
        }, token, SID_A)
        assert resp.status_code == 200, f"E1 auto_generate status={resp.status_code}"

        data = resp.json()
        assert 'grid' in data, "E1 Missing 'grid' key"
        assert 'score' in data, "E1 Missing 'score' key"
        assert 'warnings' in data, "E1 Missing 'warnings' key"

    def test_e2_quality_score(self, seed_data, api):
        """E2: quality_score returns overall_score and constraint_satisfaction."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]

        self._setup_class_subjects(seed_data, api, 'e2')

        resp = api.get(
            f'/api/academics/timetable-entries/quality_score/?class_id={class_1.id}',
            token, SID_A,
        )
        assert resp.status_code == 200, f"E2 quality_score status={resp.status_code}"

        data = resp.json()
        assert 'overall_score' in data, "E2 Missing 'overall_score'"
        assert 'constraint_satisfaction' in data, "E2 Missing 'constraint_satisfaction'"

    def test_e3_suggest_conflict_resolution(self, seed_data, api):
        """E3: suggest_resolution returns alternative_teachers or alternative_slots."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        staff_3 = seed_data['staff'][2]

        slot_ids, subj_ids = self._setup_class_subjects(seed_data, api, 'e3')

        # Create a conflict situation: staff_3 booked in class_1 MON p1
        api.post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_ids['p1'],
            'subject': subj_ids['math'],
            'teacher': staff_3.id,
        }, token, SID_A)

        resp = api.get(
            f'/api/academics/timetable-entries/suggest_resolution/'
            f'?teacher={staff_3.id}&day=MON&slot={slot_ids["p1"]}&class_id={class_2.id}'
            f'&subject={subj_ids["math"]}',
            token, SID_A,
        )
        assert resp.status_code == 200, f"E3 suggest_resolution status={resp.status_code}"
        data = resp.json()
        assert 'alternative_teachers' in data or 'alternative_slots' in data, (
            f"E3 Missing expected keys, got {list(data.keys())}"
        )

    def test_e4_suggest_substitute(self, seed_data, api):
        """E4: suggest_substitute returns 200."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        staff_1 = seed_data['staff'][0]

        resp = api.get(
            f'/api/academics/timetable-entries/suggest_substitute/'
            f'?teacher={staff_1.id}&date=2025-06-15',
            token, SID_A,
        )
        assert resp.status_code == 200, f"E4 suggest_substitute status={resp.status_code}"

    def test_e5_workload_analysis(self, seed_data, api):
        """E5: workload_analysis returns 200."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        self._setup_class_subjects(seed_data, api, 'e5')

        resp = api.get('/api/academics/class-subjects/workload_analysis/', token, SID_A)
        assert resp.status_code == 200, f"E5 workload_analysis status={resp.status_code}"

    def test_e6_gap_analysis(self, seed_data, api):
        """E6: gap_analysis returns 200."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.get('/api/academics/subjects/gap_analysis/', token, SID_A)
        assert resp.status_code == 200, f"E6 gap_analysis status={resp.status_code}"

    def test_e7_analytics_overview(self, seed_data, api):
        """E7: Analytics overview returns 200."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.safe_get('/api/academics/analytics/?type=overview', token, SID_A)
        assert resp.status_code == 200, f"E7 analytics overview status={resp.status_code}"

    def test_e8_analytics_with_date_range(self, seed_data, api):
        """E8: Analytics with date range returns 200."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.safe_get(
            '/api/academics/analytics/?date_from=2025-01-01&date_to=2025-12-31',
            token, SID_A,
        )
        assert resp.status_code == 200, f"E8 analytics date range status={resp.status_code}"


# ---------------------------------------------------------------------------
# Level F: AI Chat API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestAIChat:
    """Level F -- AI chat send, history, clear."""

    def test_f1_send_chat_message(self, seed_data, api):
        """F1: Sending a chat message returns response and message."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/academics/ai-chat/', {
            'message': 'How many subjects are assigned to classes?',
        }, token, SID_A)
        assert resp.status_code == 200, f"F1 Send chat status={resp.status_code}"

        data = resp.json()
        assert 'response' in data, "F1 Missing 'response' key"
        assert 'message' in data, "F1 Missing 'message' key"

    def test_f2_get_chat_history(self, seed_data, api):
        """F2: Chat history contains sent messages."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Send a message first
        api.post('/api/academics/ai-chat/', {
            'message': 'Test message for history',
        }, token, SID_A)

        resp = api.get('/api/academics/ai-chat/', token, SID_A)
        assert resp.status_code == 200, f"F2 Get history status={resp.status_code}"
        history = resp.json()
        assert len(history) >= 2, f"F2 Expected >=2 history entries, got {len(history)}"

    def test_f3_clear_chat_history(self, seed_data, api):
        """F3: Clearing chat history returns 200."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Send a message so there is something to clear
        api.post('/api/academics/ai-chat/', {
            'message': 'Test message to clear',
        }, token, SID_A)

        resp = api.delete('/api/academics/ai-chat/', token, SID_A)
        assert resp.status_code == 200, f"F3 Clear history status={resp.status_code}"

    def test_f4_history_empty_after_clear(self, seed_data, api):
        """F4: After clearing, history is empty."""
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Send then clear
        api.post('/api/academics/ai-chat/', {
            'message': 'Will be cleared',
        }, token, SID_A)
        api.delete('/api/academics/ai-chat/', token, SID_A)

        resp = api.get('/api/academics/ai-chat/', token, SID_A)
        assert resp.status_code == 200, f"F4 Get history after clear status={resp.status_code}"
        history = resp.json()
        assert len(history) == 0, f"F4 Expected 0 history entries, got {len(history)}"


# ---------------------------------------------------------------------------
# Level G: Cross-Cutting Tests
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase4
class TestCrossCutting:
    """Level G -- unauthenticated, invalid token, school isolation, data integrity, teacher read-only."""

    def test_g1_unauthenticated_request_returns_401(self, seed_data, api):
        """G1: Request without auth header returns 401."""
        resp = api.client.get('/api/academics/subjects/', content_type='application/json')
        assert resp.status_code == 401, f"G1 Unauthenticated -> 401, got {resp.status_code}"

    def test_g2_invalid_token_returns_401(self, seed_data, api):
        """G2: Request with invalid token returns 401."""
        SID_A = seed_data['SID_A']

        resp = api.client.get(
            '/api/academics/subjects/',
            HTTP_AUTHORIZATION='Bearer invalidtoken123',
            HTTP_X_SCHOOL_ID=str(SID_A),
            content_type='application/json',
        )
        assert resp.status_code == 401, f"G2 Invalid token -> 401, got {resp.status_code}"

    def test_g3_wrong_school_header_returns_no_test_data(self, seed_data, api):
        """G3: Admin A using School B header sees no School A data."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        SID_B = seed_data['SID_B']

        # Create subject in School A
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathG3',
            'code': 'math_g3',
        }, token, SID_A)

        # Query with School B header
        resp = api.get('/api/academics/subjects/', token, SID_B)
        results = resp.json() if resp.status_code == 200 else []
        test_in_b = [s for s in results if s.get('name', '').startswith(prefix)]
        assert len(test_in_b) == 0, f"G3 Saw {len(test_in_b)} test items via wrong school header"

    def test_g4_original_data_integrity(self, seed_data, api):
        """G4: Creating/deleting test data does not affect pre-existing records."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        # Snapshot before
        orig_subj = Subject.objects.exclude(school__name__startswith=prefix).count()
        orig_slot = TimetableSlot.objects.exclude(school__name__startswith=prefix).count()
        orig_cs = ClassSubject.objects.exclude(school__name__startswith=prefix).count()
        orig_entry = TimetableEntry.objects.exclude(school__name__startswith=prefix).count()

        # Create + delete some test objects
        api.post('/api/academics/subjects/', {
            'name': f'{prefix}IntegrityTest',
            'code': 'integ_g4',
        }, token, SID_A)
        subj_id = _get_subject_id(school_a, 'INTEG_G4')
        if subj_id:
            api.delete(f'/api/academics/subjects/{subj_id}/', token, SID_A)

        # Verify counts unchanged
        final_subj = Subject.objects.exclude(school__name__startswith=prefix).count()
        final_slot = TimetableSlot.objects.exclude(school__name__startswith=prefix).count()
        final_cs = ClassSubject.objects.exclude(school__name__startswith=prefix).count()
        final_entry = TimetableEntry.objects.exclude(school__name__startswith=prefix).count()

        assert final_subj == orig_subj, f"G4a Subjects changed: {orig_subj} -> {final_subj}"
        assert final_slot == orig_slot, f"G4b Slots changed: {orig_slot} -> {final_slot}"
        assert final_cs == orig_cs, f"G4c Class-subjects changed: {orig_cs} -> {final_cs}"
        assert final_entry == orig_entry, f"G4d Entries changed: {orig_entry} -> {final_entry}"

    def test_g5_teacher_can_read_subjects(self, seed_data, api):
        """G5: Teacher can GET subjects."""
        token = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']

        resp = api.get('/api/academics/subjects/', token, SID_A)
        assert resp.status_code == 200, f"G5 Teacher READ subjects status={resp.status_code}"

    def test_g6_teacher_can_read_slots(self, seed_data, api):
        """G6: Teacher can GET timetable-slots."""
        token = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']

        resp = api.get('/api/academics/timetable-slots/', token, SID_A)
        assert resp.status_code == 200, f"G6 Teacher READ slots status={resp.status_code}"

    def test_g7_teacher_can_read_class_subjects(self, seed_data, api):
        """G7: Teacher can GET class-subjects."""
        token = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']

        resp = api.get('/api/academics/class-subjects/', token, SID_A)
        assert resp.status_code == 200, f"G7 Teacher READ class-subjects status={resp.status_code}"

    def test_g8_teacher_cannot_patch_slot(self, seed_data, api):
        """G8: Teacher cannot PATCH a timetable slot (403)."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_teacher = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']

        # Create a slot to patch
        api.post('/api/academics/timetable-slots/', {
            'name': f'{prefix}SlotG8',
            'slot_type': 'PERIOD',
            'start_time': '08:00',
            'end_time': '08:45',
            'order': 888,
        }, token_admin, SID_A)
        slot_id = _get_slot_id(school_a, 888)
        assert slot_id is not None, "G8 Slot not created"

        resp = api.patch(f'/api/academics/timetable-slots/{slot_id}/', {
            'name': 'Hacked',
        }, token_teacher, SID_A)
        assert resp.status_code == 403, f"G8 Teacher PATCH slot -> 403, got {resp.status_code}"

    def test_g9_teacher_cannot_delete_assignment(self, seed_data, api):
        """G9: Teacher cannot DELETE a class-subject assignment (403)."""
        prefix = seed_data['prefix']
        token_admin = seed_data['tokens']['admin']
        token_teacher = seed_data['tokens']['teacher']
        SID_A = seed_data['SID_A']
        school_a = seed_data['school_a']
        class_1 = seed_data['classes'][0]

        api.post('/api/academics/subjects/', {
            'name': f'{prefix}MathG9',
            'code': 'math_g9',
        }, token_admin, SID_A)
        subj_id = _get_subject_id(school_a, 'MATH_G9')
        api.post('/api/academics/class-subjects/', {
            'class_obj': class_1.id,
            'subject': subj_id,
        }, token_admin, SID_A)
        cs_id = _get_cs_id(school_a, class_1.id, subj_id)
        assert cs_id is not None, "G9 ClassSubject not created"

        resp = api.delete(f'/api/academics/class-subjects/{cs_id}/', token_teacher, SID_A)
        assert resp.status_code == 403, f"G9 Teacher DELETE assignment -> 403, got {resp.status_code}"
