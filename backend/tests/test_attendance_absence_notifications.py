from datetime import date, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord, AttendanceUpload
from face_attendance.models import FaceAttendanceSession
from notifications.models import NotificationLog
from schools.models import UserSchoolMembership
from students.models import StudentProfile
from parents.models import ParentProfile, ParentChild
from academics.models import ClassTeacherAssignment
from users.models import User


@pytest.mark.django_db
@pytest.mark.phase10
class TestTransitionOnlyAbsenceNotifications:
    def _ensure_enrollments(self, seed_data, class_obj, students):
        for student in students:
            enrollment, _ = StudentEnrollment.objects.get_or_create(
                school=seed_data['school_a'],
                student=student,
                academic_year=seed_data['academic_year'],
                defaults={
                    'class_obj': class_obj,
                    'roll_number': student.roll_number,
                    'status': StudentEnrollment.Status.ACTIVE,
                    'is_active': True,
                },
            )
            changed = False
            if enrollment.class_obj_id != class_obj.id:
                enrollment.class_obj = class_obj
                changed = True
            if enrollment.roll_number != student.roll_number:
                enrollment.roll_number = student.roll_number
                changed = True
            if not enrollment.is_active:
                enrollment.is_active = True
                changed = True
            if changed:
                enrollment.save(update_fields=['class_obj', 'roll_number', 'is_active'])

    def test_manual_bulk_entry_notifies_only_on_transition(self, seed_data, api):
        class_obj = seed_data['classes'][0]
        s1, s2 = seed_data['students'][0], seed_data['students'][1]
        target_date = str(date.today() + timedelta(days=8))

        self._ensure_enrollments(seed_data, class_obj, [s1, s2])

        payload = {
            'class_id': class_obj.id,
            'academic_year': seed_data['academic_year'].id,
            'date': target_date,
            'entries': [
                {'student_id': s1.id, 'status': 'ABSENT'},
                {'student_id': s2.id, 'status': 'PRESENT'},
            ],
        }

        with patch('notifications.triggers.trigger_absence_notification') as mock_trigger:
            resp1 = api.post(
                '/api/attendance/records/bulk_entry/',
                payload,
                seed_data['tokens']['admin'],
                seed_data['SID_A'],
            )
            assert resp1.status_code == 200, f"first save failed: {resp1.status_code} {resp1.content}"
            assert mock_trigger.call_count == 1

            resp2 = api.post(
                '/api/attendance/records/bulk_entry/',
                payload,
                seed_data['tokens']['admin'],
                seed_data['SID_A'],
            )
            assert resp2.status_code == 200, f"second save failed: {resp2.status_code} {resp2.content}"
            assert mock_trigger.call_count == 1

    def test_ocr_confirm_skips_already_absent_records(self, seed_data, api):
        class_obj = seed_data['classes'][0]
        student_absent_already = seed_data['students'][0]
        target_date = date.today() + timedelta(days=9)

        AttendanceRecord.objects.create(
            school=seed_data['school_a'],
            academic_year=None,
            student=student_absent_already,
            date=target_date,
            status=AttendanceRecord.AttendanceStatus.ABSENT,
            source=AttendanceRecord.Source.MANUAL,
        )

        upload = AttendanceUpload.objects.create(
            school=seed_data['school_a'],
            class_obj=class_obj,
            academic_year=None,
            date=target_date,
            image_url='https://example.com/ocr-test.jpg',
            status=AttendanceUpload.Status.REVIEW_REQUIRED,
            created_by=seed_data['users']['admin'],
        )

        with patch('notifications.triggers.trigger_absence_notification') as mock_trigger:
            resp = api.post(
                f'/api/attendance/uploads/{upload.id}/confirm/',
                {'absent_student_ids': [student_absent_already.id]},
                seed_data['tokens']['admin'],
                seed_data['SID_A'],
            )
            assert resp.status_code == 200, f"confirm failed: {resp.status_code} {resp.content}"
            assert mock_trigger.call_count == 0

    def test_face_confirm_notifies_only_new_absences(self, seed_data, api):
        class_obj = seed_data['classes'][0]
        class_students = [s for s in seed_data['students'] if s.class_obj_id == class_obj.id][:4]
        pre_absent_student = class_students[-1]
        present_ids = [s.id for s in class_students[:-1]]
        target_date = date.today() + timedelta(days=10)

        AttendanceRecord.objects.create(
            school=seed_data['school_a'],
            academic_year=seed_data['academic_year'],
            student=pre_absent_student,
            date=target_date,
            status=AttendanceRecord.AttendanceStatus.ABSENT,
            source=AttendanceRecord.Source.MANUAL,
        )

        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=class_obj,
            academic_year=seed_data['academic_year'],
            date=target_date,
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/face-test.jpg',
            created_by=seed_data['users']['admin'],
        )

        with patch('notifications.triggers.trigger_absence_notification') as mock_trigger:
            resp = api.post(
                f'/api/face-attendance/sessions/{session.id}/confirm/',
                {'present_student_ids': present_ids},
                seed_data['tokens']['admin'],
                seed_data['SID_A'],
            )
            assert resp.status_code == 200, f"face confirm failed: {resp.status_code} {resp.content}"
            assert mock_trigger.call_count == 0

    def test_manual_bulk_entry_notifies_admin_teacher_parent_student_profiles(self, seed_data, api):
        class_obj = seed_data['classes'][0]
        student = seed_data['students'][0]
        target_date = str(date.today() + timedelta(days=11))

        self._ensure_enrollments(seed_data, class_obj, [student])

        # Link a class teacher for this class/year.
        class_teacher_staff = seed_data['staff'][0]
        class_teacher_user = class_teacher_staff.user
        ClassTeacherAssignment.objects.create(
            school=seed_data['school_a'],
            academic_year=seed_data['academic_year'],
            class_obj=class_obj,
            session_class=None,
            teacher=class_teacher_staff,
            is_active=True,
        )

        # Create a parent profile user and link to the student.
        parent_user = User.objects.create_user(
            username=f"{seed_data['prefix']}parent_absence",
            email=f"{seed_data['prefix']}parent_absence@test.com",
            password=seed_data['password'],
            role='PARENT',
            school=seed_data['school_a'],
            organization=seed_data['org'],
        )
        UserSchoolMembership.objects.create(
            user=parent_user,
            school=seed_data['school_a'],
            role=UserSchoolMembership.Role.PARENT,
            is_default=True,
        )
        parent_profile = ParentProfile.objects.create(
            user=parent_user,
            phone='+923001112233',
        )
        ParentChild.objects.create(
            parent=parent_profile,
            student=student,
            school=seed_data['school_a'],
            relation='FATHER',
            is_primary=True,
        )

        # Create a student profile user linked to the same student.
        student_user = User.objects.create_user(
            username=f"{seed_data['prefix']}student_absence",
            email=f"{seed_data['prefix']}student_absence@test.com",
            password=seed_data['password'],
            role='STUDENT',
            school=seed_data['school_a'],
            organization=seed_data['org'],
        )
        UserSchoolMembership.objects.create(
            user=student_user,
            school=seed_data['school_a'],
            role=UserSchoolMembership.Role.STUDENT,
            is_default=True,
        )
        StudentProfile.objects.create(
            user=student_user,
            student=student,
            school=seed_data['school_a'],
        )

        payload = {
            'class_id': class_obj.id,
            'academic_year': seed_data['academic_year'].id,
            'date': target_date,
            'entries': [
                {'student_id': student.id, 'status': 'ABSENT'},
            ],
        }
        started_at = timezone.now()
        resp = api.post(
            '/api/attendance/records/bulk_entry/',
            payload,
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"bulk entry failed: {resp.status_code} {resp.content}"

        logs = NotificationLog.objects.filter(
            school=seed_data['school_a'],
            event_type='ABSENCE',
            channel='IN_APP',
            student=student,
            created_at__gte=started_at,
        )
        actual_user_ids = set(logs.values_list('recipient_user_id', flat=True))
        expected_user_ids = {
            seed_data['users']['admin'].id,
            class_teacher_user.id,
            parent_user.id,
            student_user.id,
        }

        missing = expected_user_ids - actual_user_ids
        assert not missing, f"missing recipients for absence notification: {sorted(missing)}"
