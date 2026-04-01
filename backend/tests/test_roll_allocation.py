import pytest
from datetime import date

from academic_sessions.models import AcademicYear, StudentEnrollment
from admissions.models import AdmissionEnquiry


pytestmark = pytest.mark.django_db


class TestRollAllocation:
    def test_batch_convert_uses_next_highest_roll(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        ay = seed_data['academic_year']
        class_1 = seed_data['classes'][0]

        # Force a high existing snapshot roll in class so conversion must allocate next number.
        from students.models import Student

        Student.objects.create(
            school=seed_data['school_a'],
            class_obj=class_1,
            roll_number='50',
            name=f"{seed_data['prefix']}Roll Anchor",
            is_active=True,
            status='ACTIVE',
        )

        create_resp = api.post('/api/admissions/enquiries/', {
            'name': f"{seed_data['prefix']}Roll Convert Child",
            'father_name': f"{seed_data['prefix']}Roll Convert Parent",
            'mobile': '03001234567',
            'applying_for_grade_level': '1',
            'source': 'WALK_IN',
        }, token, sid)
        assert create_resp.status_code == 201, create_resp.content[:200]
        enquiry_id = create_resp.json()['id']

        confirm_resp = api.patch(f'/api/admissions/enquiries/{enquiry_id}/update-status/', {
            'status': 'CONFIRMED',
        }, token, sid)
        assert confirm_resp.status_code == 200, confirm_resp.content[:200]

        convert_resp = api.post('/api/admissions/enquiries/batch-convert/', {
            'enquiry_ids': [enquiry_id],
            'academic_year_id': ay.id,
            'class_id': class_1.id,
            'generate_fees': False,
        }, token, sid)

        assert convert_resp.status_code == 201, convert_resp.content[:300]
        converted = convert_resp.json().get('converted') or []
        assert len(converted) == 1
        assert converted[0]['roll_number'] == '51'

    def test_bulk_promote_roll_collision_gets_next_highest(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]

        promoted_student = seed_data['students'][0]  # class_1
        target_class_student = seed_data['students'][4]  # class_2, roll 1

        # Source-year enrollment required for promotion.
        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=promoted_student,
            academic_year=source_year,
            class_obj=class_1,
            roll_number=promoted_student.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2026-2027",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )

        # Existing target-year roll 1 in class_2.
        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=target_class_student,
            academic_year=target_year,
            class_obj=class_2,
            roll_number='1',
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

        resp = api.post('/api/sessions/enrollments/bulk_promote/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'promotions': [{
                'student_id': promoted_student.id,
                'target_class_id': class_2.id,
                'new_roll_number': '1',
                'action': 'PROMOTE',
            }],
        }, token, sid)

        assert resp.status_code == 200, resp.content[:300]
        data = resp.json().get('result', {})
        assert data.get('promoted') == 1
        assert data.get('errors') == []

        promoted_student.refresh_from_db()
        assert promoted_student.class_obj_id == class_2.id
        assert promoted_student.roll_number == '4'

        target_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=promoted_student,
            academic_year=target_year,
        )
        assert target_enrollment.roll_number == '4'

    def test_bulk_promote_rejects_duplicate_target_rolls_in_payload(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]

        s1 = seed_data['students'][1]
        s2 = seed_data['students'][2]

        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=s1,
            academic_year=source_year,
            class_obj=class_1,
            roll_number=s1.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )
        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=s2,
            academic_year=source_year,
            class_obj=class_1,
            roll_number=s2.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2027-2028",
            start_date=date(2027, 4, 1),
            end_date=date(2028, 3, 31),
            is_current=False,
            is_active=True,
        )

        resp = api.post('/api/sessions/enrollments/bulk_promote/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'promotions': [
                {
                    'student_id': s1.id,
                    'target_class_id': class_2.id,
                    'new_roll_number': '9',
                    'action': 'PROMOTE',
                },
                {
                    'student_id': s2.id,
                    'target_class_id': class_2.id,
                    'new_roll_number': '9',
                    'action': 'PROMOTE',
                },
            ],
        }, token, sid)

        assert resp.status_code == 400, resp.content[:300]
