"""Deleting a student must leave an audit entry saying who, when, from where, and
what the row owned. A delete used to leave no trace at all, so a student vanishing
from the portal could not be traced back to anyone."""
import pytest

from core.models import AdminActionLog
from students.models import Student


@pytest.mark.django_db
class TestStudentDeleteAudit:
    def delete(self, api, ctx, student, **extra):
        return api.client.delete(
            f'/api/students/{student.id}/',
            HTTP_AUTHORIZATION=f"Bearer {ctx['tokens']['admin']}",
            HTTP_X_SCHOOL_ID=str(ctx['SID_A']),
            content_type='application/json',
            **extra,
        )

    def test_delete_writes_an_audit_entry_with_actor_school_and_snapshot(self, api, seed_data):
        student = seed_data['students'][0]
        name, sid = student.name, student.id

        resp = self.delete(api, seed_data, student)

        assert resp.status_code == 204, resp.content
        assert not Student.objects.filter(id=sid).exists()
        log = AdminActionLog.objects.get(action='soft_delete', target_type='Student', target_id=str(sid))
        assert log.actor == seed_data['users']['admin']
        assert log.school_id == seed_data['SID_A']
        assert log.target_repr
        assert log.metadata['snapshot']['name'] == name
        assert log.metadata['snapshot']['class_obj_id'] == student.class_obj_id

    def test_entry_counts_what_the_student_owned(self, api, seed_data):
        from academic_sessions.models import StudentEnrollment
        student = seed_data['students'][0]
        StudentEnrollment.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            class_obj=student.class_obj, roll_number=student.roll_number, status='ACTIVE',
        )

        self.delete(api, seed_data, student)

        log = AdminActionLog.objects.get(action='soft_delete', target_id=str(student.id))
        assert log.metadata['related_counts']['academic_sessions.StudentEnrollment.student'] == 1

    def test_entry_records_the_real_client_ip_behind_the_proxy(self, api, seed_data):
        student = seed_data['students'][0]

        self.delete(api, seed_data, student, HTTP_X_FORWARDED_FOR='203.0.113.7, 10.0.0.1',
                    HTTP_USER_AGENT='TestBrowser/1.0')

        log = AdminActionLog.objects.get(action='soft_delete', target_id=str(student.id))
        assert log.ip_address == '203.0.113.7'
        assert log.user_agent == 'TestBrowser/1.0'

    def test_refused_delete_writes_no_entry(self, api, seed_data):
        # A transfer-linked student cannot be deleted, so there is nothing to log.
        source, dest = seed_data['students'][0], seed_data['students'][1]
        dest.transferred_from = source
        dest.save(update_fields=['transferred_from'])

        resp = self.delete(api, seed_data, source)

        assert resp.status_code == 400
        assert Student.objects.filter(id=source.id).exists()
        assert not AdminActionLog.objects.filter(action='soft_delete', target_id=str(source.id)).exists()
