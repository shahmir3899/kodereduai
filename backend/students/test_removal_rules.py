"""What counts as history for a student, and the preview the Status & exit
dialog reads (removal rules, step 1)."""
from datetime import date

import pytest

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord
from finance.models import FeePayment
from students.lifecycle import IGNORED_RELATIONS, history_counts, student_has_history
from students.models import Student


@pytest.fixture
def fresh(seed_data):
    """A student with only the enrollment that creating one makes."""
    base = seed_data['students'][0]
    student = Student.objects.create(
        school=seed_data['school_a'], class_obj=base.class_obj, roll_number='990', name='Fresh Student',
    )
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        class_obj=base.class_obj, roll_number='990', status='ACTIVE',
    )
    return student


def preview(api, ctx, student, token='admin'):
    return api.get(f'/api/students/{student.id}/removal-preview/', ctx['tokens'][token], ctx['SID_A'])


@pytest.mark.django_db
class TestHistory:
    def test_new_student_has_no_history(self, fresh):
        assert history_counts(fresh) == {}
        assert not student_has_history(fresh)

    def test_attendance_is_history(self, seed_data, fresh):
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], student=fresh, academic_year=seed_data['academic_year'],
            date=date(2026, 1, 5), status='PRESENT',
        )
        assert student_has_history(fresh)

    def test_fee_is_history(self, seed_data, fresh):
        FeePayment.objects.create(
            school=seed_data['school_a'], student=fresh, fee_type='MONTHLY', month=1, year=2026, amount_due=10,
        )
        assert 'finance.FeePayment.student' in history_counts(fresh)

    def test_a_second_enrollment_is_history(self, seed_data, fresh):
        from academic_sessions.models import AcademicYear
        old = AcademicYear.objects.create(
            school=seed_data['school_a'], name='Old', start_date=date(2024, 4, 1), end_date=date(2025, 3, 31),
        )
        StudentEnrollment.objects.create(
            school=seed_data['school_a'], student=fresh, academic_year=old, class_obj=fresh.class_obj,
            roll_number='990', status='PROMOTED', is_active=False,
        )
        assert history_counts(fresh)['academic_sessions.StudentEnrollment.student'] == 2

    def test_closed_single_enrollment_is_history(self, fresh):
        StudentEnrollment.objects.filter(student=fresh).update(status='GRADUATED')
        assert student_has_history(fresh)

    def test_ignored_relations_name_real_tables(self):
        known = {
            f'{r.related_model._meta.label}.{r.field.name}' for r in Student._meta.related_objects
        }
        assert IGNORED_RELATIONS <= known


@pytest.mark.django_db
class TestRemovalPreview:
    def test_clean_student(self, api, seed_data, fresh):
        body = preview(api, seed_data, fresh).json()
        assert body['has_history'] is False
        assert body['can_purge'] is True
        assert body['allowed_outcomes'] == ['LEFT', 'TRANSFERRED', 'GRADUATED', 'REPEAT', 'REMOVE']

    def test_student_with_records_reports_counts(self, api, seed_data):
        student = seed_data['students'][0]
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            date=date(2026, 1, 5), status='PRESENT',
        )
        body = preview(api, seed_data, student).json()
        assert body['has_history'] is True
        assert body['can_purge'] is False
        assert body['counts']['attendance'] == 1

    def test_departed_student_is_offered_readmit_not_leaving(self, api, seed_data, fresh):
        Student.objects.filter(pk=fresh.pk).update(status='WITHDRAWN')
        outcomes = preview(api, seed_data, fresh).json()['allowed_outcomes']
        assert 'READMIT' in outcomes and 'LEFT' not in outcomes

    @pytest.mark.parametrize('token', ['teacher', 'accountant', 'manager', 'staff'])
    def test_non_admins_are_refused(self, api, seed_data, fresh, token):
        assert preview(api, seed_data, token=token, student=fresh).status_code == 403

    def test_principal_allowed(self, api, seed_data, fresh):
        assert preview(api, seed_data, fresh, token='principal').status_code == 200


# --- Step 2: manual Graduated / Repeat -------------------------------------------------

from academic_sessions.models import AcademicYear, PromotionEvent  # noqa: E402
from core.models import AdminActionLog  # noqa: E402


def outcome(api, ctx, student, token='admin', **body):
    return api.post(f'/api/students/{student.id}/outcome/', body, ctx['tokens'][token], ctx['SID_A'])


@pytest.fixture
def enrolled(seed_data):
    student = seed_data['students'][1]
    enrollment, _ = StudentEnrollment.objects.get_or_create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        defaults={'class_obj': student.class_obj, 'roll_number': student.roll_number, 'status': 'ACTIVE'},
    )
    return student, enrollment


@pytest.fixture
def next_year(seed_data):
    year = seed_data['academic_year']
    return AcademicYear.objects.create(
        school=seed_data['school_a'], name='Next Year', is_current=False,
        start_date=date(year.end_date.year, 4, 1), end_date=date(year.end_date.year + 1, 3, 31),
    )


@pytest.mark.django_db
class TestManualOutcome:
    def test_graduate_updates_enrollment_and_snapshot_and_logs(self, api, seed_data, enrolled):
        student, enrollment = enrolled
        resp = outcome(api, seed_data, student, outcome='GRADUATED', reason='Finished class 10')
        assert resp.status_code == 200, resp.content
        enrollment.refresh_from_db(); student.refresh_from_db()
        assert enrollment.status == 'GRADUATED' and student.status == 'GRADUATED'
        assert student.is_active is True
        assert PromotionEvent.objects.filter(student=student, event_type='GRADUATED').exists()
        assert AdminActionLog.objects.filter(action='student_outcome', target_id=str(student.id)).exists()

    def test_graduated_student_comes_back_to_repeat_when_next_year_exists(self, api, seed_data, enrolled, next_year):
        student, enrollment = enrolled
        assert outcome(api, seed_data, student, outcome='GRADUATED', reason='Passed').status_code == 200
        resp = outcome(api, seed_data, student, outcome='REPEAT', reason='Parents asked to repeat')
        assert resp.status_code == 200, resp.content
        enrollment.refresh_from_db()
        assert enrollment.status == 'REPEAT'
        again = StudentEnrollment.objects.get(student=student, academic_year=next_year)
        assert again.class_obj_id == enrollment.class_obj_id

    def test_promoted_student_can_still_be_graduated(self, api, seed_data, enrolled, next_year):
        student, enrollment = enrolled
        StudentEnrollment.objects.filter(pk=enrollment.pk).update(status='PROMOTED')
        StudentEnrollment.objects.create(
            school=seed_data['school_a'], student=student, academic_year=next_year,
            class_obj=student.class_obj, roll_number='77', status='ACTIVE',
        )
        resp = outcome(api, seed_data, student, outcome='GRADUATED', reason='Corrected')
        assert resp.status_code == 200, resp.content
        enrollment.refresh_from_db()
        assert enrollment.status == 'GRADUATED'
        assert not StudentEnrollment.objects.filter(student=student, academic_year=next_year).exists()

    def test_refused_when_later_year_already_has_attendance(self, api, seed_data, enrolled, next_year):
        student, enrollment = enrolled
        StudentEnrollment.objects.create(
            school=seed_data['school_a'], student=student, academic_year=next_year,
            class_obj=student.class_obj, roll_number='77', status='ACTIVE',
        )
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], student=student, academic_year=next_year,
            date=next_year.start_date, status='PRESENT',
        )
        resp = outcome(api, seed_data, student, outcome='GRADUATED', reason='x')
        assert resp.status_code == 400 and resp.json()['code'] == 'later_year_has_records'

    def test_reason_required(self, api, seed_data, enrolled):
        resp = outcome(api, seed_data, enrolled[0], outcome='REPEAT', reason=' ')
        assert resp.status_code == 400 and resp.json()['code'] == 'reason_required'

    def test_departed_student_refused(self, api, seed_data, enrolled):
        student, _ = enrolled
        Student.objects.filter(pk=student.pk).update(status='WITHDRAWN')
        resp = outcome(api, seed_data, student, outcome='GRADUATED', reason='x')
        assert resp.status_code == 400 and resp.json()['code'] == 'student_departed'

    @pytest.mark.parametrize('token', ['teacher', 'accountant', 'manager', 'staff'])
    def test_non_admins_refused(self, api, seed_data, enrolled, token):
        resp = outcome(api, seed_data, enrolled[0], token=token, outcome='GRADUATED', reason='x')
        assert resp.status_code == 403

    def test_graduate_shows_in_older_year_listing(self, api, seed_data, enrolled, next_year):
        student, _ = enrolled
        assert outcome(api, seed_data, student, outcome='GRADUATED', reason='Passed').status_code == 200
        year = seed_data['academic_year']
        resp = api.get(
            f'/api/students/?status_scope=graduated&academic_year={year.id}&page_size=200',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        ).json()
        assert student.id in {r['id'] for r in resp['results']}
