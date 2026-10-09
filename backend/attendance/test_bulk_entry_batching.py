"""bulk_entry used to do one update_or_create per student (3-4 round trips each, ~0.1s
apiece to the Singapore DB). Saving a register must cost a fixed handful of queries
no matter how big the class is, and must keep every rule it had."""
from datetime import date
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord
from notifications.models import SchoolNotificationConfig
from students.models import Student

pytestmark = pytest.mark.django_db

URL = '/api/attendance/records/bulk_entry/'
DAY = date(2026, 3, 2)


@pytest.fixture
def roster(seed_data):
    """Class_1A with 4 seeded students plus 30 more, all enrolled for the seed year."""
    school, year = seed_data['school_a'], seed_data['academic_year']
    class_obj = seed_data['classes'][0]
    students = [s for s in seed_data['students'] if s.class_obj_id == class_obj.id]
    for i in range(30):
        students.append(Student.objects.create(
            school=school, class_obj=class_obj, roll_number=f'x{i}',
            name=f'ZZ_batch_{i}', is_active=True, status='ACTIVE',
        ))
    for s in students:
        StudentEnrollment.objects.get_or_create(
            school=school, student=s, academic_year=year,
            defaults={'class_obj': class_obj, 'roll_number': s.roll_number,
                      'status': 'ACTIVE', 'is_active': True},
        )
    # Notifications off: this file measures the save itself, not the digest.
    SchoolNotificationConfig.objects.update_or_create(
        school=school, defaults={'absence_notification_enabled': False},
    )
    return {'class_obj': class_obj, 'students': students}


def save(api, seed_data, roster, students, statuses=None, **extra):
    statuses = statuses or ['PRESENT'] * len(students)
    payload = {
        'class_id': roster['class_obj'].id,
        'academic_year': seed_data['academic_year'].id,
        'date': str(DAY),
        'entries': [{'student_id': s.id, 'status': st} for s, st in zip(students, statuses)],
        **extra,
    }
    return api.post(URL, payload, seed_data['tokens']['admin'], seed_data['SID_A'])


def count_queries(api, seed_data, roster, students):
    with CaptureQueriesContext(connection) as ctx:
        resp = save(api, seed_data, roster, students)
    assert resp.status_code == 200, resp.content
    return len(ctx)


class TestQueryBudget:
    def test_cost_does_not_grow_with_class_size(self, api, seed_data, roster):
        small = roster['students'][:4]
        count_queries(api, seed_data, roster, small)  # warm caches/permissions
        AttendanceRecord.objects.all().delete()

        few = count_queries(api, seed_data, roster, small)
        AttendanceRecord.objects.all().delete()
        many = count_queries(api, seed_data, roster, roster['students'])

        # 30 more students must not add a query each.
        assert many - few <= 3, f'{few} queries for 4 students, {many} for {len(roster["students"])}'

    def test_re_saving_an_existing_register_is_also_flat(self, api, seed_data, roster):
        count_queries(api, seed_data, roster, roster['students'])  # creates every row

        again = count_queries(api, seed_data, roster, roster['students'])

        assert again <= 40, f'{again} queries to re-save {len(roster["students"])} rows'


class TestBehaviourIsUnchanged:
    def test_creates_then_updates_and_reports_counts(self, api, seed_data, roster):
        first = roster['students'][:3]
        assert save(api, seed_data, roster, first).json()['created'] == 3

        resp = save(api, seed_data, roster, roster['students'][:5], ['ABSENT'] * 5)

        body = resp.json()
        assert (body['created'], body['updated'], body['errors']) == (2, 3, [])
        assert body['message'] == '5 attendance records saved.'
        assert set(AttendanceRecord.objects.filter(date=DAY).values_list('status', flat=True)) == {'ABSENT'}

    def test_a_manual_save_overwrites_status_source_and_upload(self, api, seed_data, roster):
        student = roster['students'][0]
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            date=DAY, status='ABSENT', source=AttendanceRecord.Source.IMAGE_AI,
        )

        save(api, seed_data, roster, [student], ['LEAVE'])

        record = AttendanceRecord.objects.get(student=student, date=DAY)
        assert record.status == 'LEAVE'
        assert record.source == AttendanceRecord.Source.MANUAL
        assert record.upload_id is None
        assert record.academic_year_id == seed_data['academic_year'].id
        assert AttendanceRecord.objects.filter(student=student, date=DAY).count() == 1

    def test_a_student_outside_the_class_is_refused_but_the_rest_are_saved(self, api, seed_data, roster):
        outsider = next(s for s in seed_data['students'] if s.class_obj_id != roster['class_obj'].id)
        entries = roster['students'][:2] + [outsider]

        body = save(api, seed_data, roster, entries).json()

        assert (body['created'], len(body['errors'])) == (2, 1)
        assert body['errors'][0]['student_id'] == outsider.id
        assert not AttendanceRecord.objects.filter(student=outsider, date=DAY).exists()

    def test_a_departed_student_is_refused(self, api, seed_data, roster):
        gone = roster['students'][0]
        StudentEnrollment.objects.filter(student=gone, academic_year=seed_data['academic_year']).update(
            status='WITHDRAWN', is_active=False, left_date=date(2026, 2, 1),
        )

        body = save(api, seed_data, roster, roster['students'][:2]).json()

        assert (body['created'], len(body['errors'])) == (1, 1)
        assert body['errors'][0]['student_id'] == gone.id

    def test_if_the_batch_write_fails_rows_are_still_saved_one_by_one(self, api, seed_data, roster):
        with patch('attendance.views.AttendanceRecord.objects.bulk_create', side_effect=RuntimeError('boom')):
            body = save(api, seed_data, roster, roster['students'][:3]).json()

        assert (body['created'], body['errors']) == (3, [])
