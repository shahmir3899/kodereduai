import pytest
from datetime import date

from academic_sessions.models import (
    AcademicYear,
    StudentEnrollment,
    SessionClass,
    PromotionOperation,
    PromotionEvent,
)
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

    def test_bulk_promote_repeat_keeps_student_snapshot_active(self, seed_data, api):
        from students.models import Student

        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        class_1 = seed_data['classes'][0]

        repeat_student = seed_data['students'][0]

        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=repeat_student,
            academic_year=source_year,
            class_obj=class_1,
            roll_number=repeat_student.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2026-2027-repeat-active",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )

        resp = api.post('/api/sessions/enrollments/bulk_promote/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'promotions': [{
                'student_id': repeat_student.id,
                'target_class_id': class_1.id,
                'new_roll_number': '77',
                'action': 'REPEAT',
            }],
        }, token, sid)

        assert resp.status_code == 200, resp.content[:300]
        data = resp.json().get('result', {})
        assert data.get('promoted') == 1
        assert data.get('errors') == []

        repeat_student.refresh_from_db()
        assert repeat_student.status == Student.Status.ACTIVE

        source_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=repeat_student,
            academic_year=source_year,
        )
        assert source_enrollment.status == StudentEnrollment.Status.REPEAT

        target_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=repeat_student,
            academic_year=target_year,
        )
        assert target_enrollment.roll_number == '77'

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


class TestPromotionHistoryAndCorrections:
    def _build_source_target_state(self, seed_data, student, source_year, target_year, source_class, target_class, source_roll='1', target_roll='11'):
        from students.models import Student

        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=student,
            academic_year=source_year,
            class_obj=source_class,
            roll_number=source_roll,
            status=StudentEnrollment.Status.PROMOTED,
            is_active=True,
        )
        StudentEnrollment.objects.create(
            school=seed_data['school_a'],
            student=student,
            academic_year=target_year,
            class_obj=target_class,
            roll_number=target_roll,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )
        Student.objects.filter(pk=student.id).update(
            class_obj_id=target_class.id,
            roll_number=target_roll,
            status=Student.Status.ACTIVE,
        )

    def test_promotion_history_returns_event_rows(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2026-2027-history",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )
        student = seed_data['students'][0]
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]

        self._build_source_target_state(
            seed_data,
            student,
            source_year,
            target_year,
            class_1,
            class_2,
            source_roll='1',
            target_roll='15',
        )

        operation = PromotionOperation.objects.create(
            school=seed_data['school_a'],
            source_academic_year=source_year,
            target_academic_year=target_year,
            operation_type=PromotionOperation.OperationType.BULK_PROMOTE,
            total_students=1,
            initiated_by=seed_data['users']['admin'],
        )
        PromotionEvent.objects.create(
            school=seed_data['school_a'],
            operation=operation,
            student=student,
            source_academic_year=source_year,
            target_academic_year=target_year,
            source_class=class_1,
            target_class=class_2,
            event_type=PromotionEvent.EventType.PROMOTED,
            old_status=StudentEnrollment.Status.ACTIVE,
            new_status=StudentEnrollment.Status.PROMOTED,
            old_roll_number='1',
            new_roll_number='15',
            reason='initial promotion',
            created_by=seed_data['users']['admin'],
        )

        resp = api.get(
            f'/api/sessions/enrollments/promotion-history/?academic_year={target_year.id}&page_size=20',
            token,
            sid,
        )
        assert resp.status_code == 200, resp.content[:300]
        body = resp.json()
        rows = body.get('results', body)
        assert len(rows) >= 1
        assert any(r.get('event_type') == 'PROMOTED' for r in rows)
        assert any(r.get('operation_type') == 'BULK_PROMOTE' for r in rows)

    def test_correct_single_reapplys_repeat_and_logs_operation(self, seed_data, api):
        from students.models import Student

        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2026-2027-csingle",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )
        student = seed_data['students'][1]
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]

        self._build_source_target_state(
            seed_data,
            student,
            source_year,
            target_year,
            class_1,
            class_2,
            source_roll='2',
            target_roll='16',
        )

        resp = api.post('/api/sessions/enrollments/correct-single/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'student_id': student.id,
            'action': 'REPEAT',
            'target_class_id': class_1.id,
            'new_roll_number': '22',
            'reason': 'Should repeat in same class',
        }, token, sid)
        assert resp.status_code == 200, resp.content[:300]
        payload = resp.json()
        assert payload.get('operation_id')
        assert payload.get('result', {}).get('ok') is True

        source_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=student,
            academic_year=source_year,
        )
        target_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=student,
            academic_year=target_year,
        )
        assert source_enrollment.status == StudentEnrollment.Status.REPEAT
        assert target_enrollment.class_obj_id == class_1.id

        student.refresh_from_db()
        assert student.status == Student.Status.ACTIVE

        operation = PromotionOperation.objects.get(pk=payload['operation_id'])
        assert operation.operation_type == PromotionOperation.OperationType.SINGLE_CORRECTION
        event_types = list(operation.events.values_list('event_type', flat=True))
        assert 'REVERSED' in event_types
        assert 'REPEATED' in event_types

    def test_correct_single_repeat_ignores_stale_promoted_target_class(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2026-2027-csingle-repeat-stale-target",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )
        student = seed_data['students'][2]
        source_class = seed_data['classes'][0]
        promoted_target_class = seed_data['classes'][1]

        self._build_source_target_state(
            seed_data,
            student,
            source_year,
            target_year,
            source_class,
            promoted_target_class,
            source_roll='5',
            target_roll='25',
        )

        # Simulate stale UI payload carrying promoted target for a REPEAT correction.
        resp = api.post('/api/sessions/enrollments/correct-single/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'student_id': student.id,
            'action': 'REPEAT',
            'target_class_id': promoted_target_class.id,
            'new_roll_number': '26',
            'reason': 'Repeat should not stay in promoted class',
        }, token, sid)

        assert resp.status_code == 200, resp.content[:300]

        source_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=student,
            academic_year=source_year,
        )
        target_enrollment = StudentEnrollment.objects.get(
            school=seed_data['school_a'],
            student=student,
            academic_year=target_year,
        )

        assert source_enrollment.status == StudentEnrollment.Status.REPEAT
        assert target_enrollment.class_obj_id == source_class.id

    def test_correct_single_repeat_maps_target_session_when_class_ids_drift(self, seed_data, api):
        from students.models import Student, Class

        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school = seed_data['school_a']

        source_year = AcademicYear.objects.create(
            school=school,
            name=f"{seed_data['prefix']}2025-2026-repeat-drift-src",
            start_date=date(2025, 4, 1),
            end_date=date(2026, 3, 31),
            is_current=False,
            is_active=True,
        )
        target_year = AcademicYear.objects.create(
            school=school,
            name=f"{seed_data['prefix']}2026-2027-repeat-drift-tgt",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )

        source_class = Class.objects.create(
            school=school,
            name='Class 1',
            section='A',
            grade_level=3,
            is_active=True,
        )
        target_repeat_class = Class.objects.create(
            school=school,
            name='Class 1',
            section='',
            grade_level=3,
            is_active=True,
        )
        promoted_class = Class.objects.create(
            school=school,
            name='Class 2',
            section='A',
            grade_level=4,
            is_active=True,
        )

        source_session = SessionClass.objects.create(
            school=school,
            academic_year=source_year,
            class_obj=source_class,
            display_name='Class 1',
            section='A',
            grade_level=3,
            is_active=True,
        )
        target_repeat_session = SessionClass.objects.create(
            school=school,
            academic_year=target_year,
            class_obj=target_repeat_class,
            display_name='Class 1',
            section='',
            grade_level=3,
            is_active=True,
        )
        target_promoted_session = SessionClass.objects.create(
            school=school,
            academic_year=target_year,
            class_obj=promoted_class,
            display_name='Class 2',
            section='A',
            grade_level=4,
            is_active=True,
        )

        student = seed_data['students'][5]

        StudentEnrollment.objects.create(
            school=school,
            student=student,
            academic_year=source_year,
            class_obj=source_class,
            session_class=source_session,
            roll_number='1',
            status=StudentEnrollment.Status.PROMOTED,
            is_active=True,
        )
        StudentEnrollment.objects.create(
            school=school,
            student=student,
            academic_year=target_year,
            class_obj=promoted_class,
            session_class=target_promoted_session,
            roll_number='9',
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )
        Student.objects.filter(pk=student.id).update(
            class_obj_id=promoted_class.id,
            roll_number='9',
            status=Student.Status.ACTIVE,
        )

        resp = api.post('/api/sessions/enrollments/correct-single/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'student_id': student.id,
            'action': 'REPEAT',
            'target_class_id': promoted_class.id,
            'new_roll_number': '9',
            'reason': 'Repeat should resolve to target year Class 1 mapping',
        }, token, sid)

        assert resp.status_code == 200, resp.content[:300]

        target_enrollment = StudentEnrollment.objects.get(
            school=school,
            student=student,
            academic_year=target_year,
        )
        assert target_enrollment.class_obj_id == target_repeat_class.id
        assert target_enrollment.session_class_id == target_repeat_session.id

    def test_correct_bulk_dry_run_returns_previews_without_mutation(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        source_year = seed_data['academic_year']
        target_year = AcademicYear.objects.create(
            school=seed_data['school_a'],
            name=f"{seed_data['prefix']}2026-2027-cbulk",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=False,
            is_active=True,
        )
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        s1 = seed_data['students'][2]
        s2 = seed_data['students'][3]

        self._build_source_target_state(
            seed_data,
            s1,
            source_year,
            target_year,
            class_1,
            class_2,
            source_roll='3',
            target_roll='17',
        )
        self._build_source_target_state(
            seed_data,
            s2,
            source_year,
            target_year,
            class_1,
            class_2,
            source_roll='4',
            target_roll='18',
        )

        source_before = {
            row.student_id: row.status
            for row in StudentEnrollment.objects.filter(
                school=seed_data['school_a'],
                academic_year=source_year,
                student_id__in=[s1.id, s2.id],
            )
        }

        resp = api.post('/api/sessions/enrollments/correct-bulk/', {
            'source_academic_year': source_year.id,
            'target_academic_year': target_year.id,
            'dry_run': True,
            'corrections': [
                {
                    'student_id': s1.id,
                    'action': 'PROMOTE',
                    'target_class_id': class_2.id,
                    'new_roll_number': '31',
                    'reason': 'dry run check 1',
                },
                {
                    'student_id': s2.id,
                    'action': 'REPEAT',
                    'target_class_id': class_1.id,
                    'new_roll_number': '32',
                    'reason': 'dry run check 2',
                },
            ],
        }, token, sid)
        assert resp.status_code == 200, resp.content[:300]
        body = resp.json()
        assert body.get('dry_run') is True
        assert body.get('corrected') == 0
        assert len(body.get('previews', [])) == 2

        source_after = {
            row.student_id: row.status
            for row in StudentEnrollment.objects.filter(
                school=seed_data['school_a'],
                academic_year=source_year,
                student_id__in=[s1.id, s2.id],
            )
        }
        assert source_after == source_before
