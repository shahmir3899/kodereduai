"""The last line of defence against losing students: a class that still has students
cannot be deleted (it used to cascade them away), and on Postgres a trigger refuses
any raw DELETE of a student unless the transaction opted in."""
import pytest
from django.db import IntegrityError, connection, transaction

from attendance.models import AttendanceRecord
from core.db_guards import allow_student_hard_delete
from students.models import Class, Student

postgres_only = pytest.mark.skipif(
    connection.vendor != 'postgresql',
    reason='the delete trigger only exists on Postgres (SQLite has no equivalent)',
)


@pytest.mark.django_db
class TestClassDeleteGuard:
    def test_a_class_with_students_cannot_be_deleted(self, api, seed_data):
        student = seed_data['students'][0]
        class_obj = student.class_obj

        resp = api.delete(f'/api/classes/{class_obj.id}/', seed_data['tokens']['admin'], seed_data['SID_A'])

        assert resp.status_code == 400
        assert resp.json()['code'] == 'class_has_students'
        assert Class.objects.filter(id=class_obj.id).exists()
        assert Student.objects.filter(id=student.id).exists()

    def test_removed_students_still_block_the_class_delete(self, api, seed_data):
        # A soft-deleted student is only hidden; deleting the class would erase them for good.
        student = seed_data['students'][0]
        student.soft_delete()

        resp = api.delete(f'/api/classes/{student.class_obj_id}/', seed_data['tokens']['admin'], seed_data['SID_A'])

        assert resp.status_code == 400
        assert Student.all_objects.filter(id=student.id).exists()

    def test_an_empty_class_can_still_be_deleted(self, api, seed_data):
        empty = Class.objects.create(school=seed_data['school_a'], name='Empty Class', grade_level=9)

        resp = api.delete(f'/api/classes/{empty.id}/', seed_data['tokens']['admin'], seed_data['SID_A'])

        assert resp.status_code == 204
        assert not Class.objects.filter(id=empty.id).exists()


@pytest.mark.django_db
class TestHardDelete:
    def test_hard_delete_inside_the_guard_removes_the_student_and_their_records(self, seed_data):
        from datetime import date
        student = seed_data['students'][0]
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            date=date(2026, 1, 5), status='PRESENT',
        )

        student.hard_delete()

        assert not Student.all_objects.filter(id=student.id).exists()
        assert not AttendanceRecord.objects.filter(student_id=student.id).exists()


@postgres_only
@pytest.mark.django_db(transaction=True)
class TestPostgresTrigger:
    def test_a_raw_delete_is_refused(self, seed_data):
        student = seed_data['students'][0]

        with pytest.raises(IntegrityError, match='blocked'):
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute('DELETE FROM students_student WHERE id = %s', [student.id])

        assert Student.all_objects.filter(id=student.id).exists()

    def test_a_cascade_from_a_parent_row_is_refused(self, seed_data):
        class_obj = seed_data['students'][0].class_obj

        with pytest.raises(IntegrityError, match='blocked'):
            Class.objects.filter(id=class_obj.id).delete()

        assert Student.all_objects.filter(class_obj_id=class_obj.id).exists()

    def test_the_opt_in_is_transaction_local(self, seed_data):
        # Fresh students: raw SQL skips Django's cascade/SET_NULL handling, so a seed
        # student that other tables reference would fail on its foreign keys instead.
        class_obj = seed_data['students'][0].class_obj
        first, second = (
            Student.objects.create(
                school=seed_data['school_a'], class_obj=class_obj, roll_number=f'90{i}', name=f'Guard {i}',
            ) for i in range(2)
        )

        with allow_student_hard_delete():
            with connection.cursor() as cursor:
                cursor.execute('DELETE FROM students_student WHERE id = %s', [first.id])
        assert not Student.all_objects.filter(id=first.id).exists()

        # The flag must not outlive that block on the same connection.
        with pytest.raises(IntegrityError, match='blocked'):
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute('DELETE FROM students_student WHERE id = %s', [second.id])
