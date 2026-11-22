"""Monthly snapshots: frozen figures equal the live ones, reads switch over only for whole months,
re-freezing replaces rows, and teachers are told (or not) as the school's settings say."""
import json
from datetime import date

import pytest
from django.core.management import call_command

from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from hr.models import StaffAttendance, TeacherPerformanceConfig, TeacherPerformanceSnapshot
from hr.performance.service import compute
from hr.performance.snapshots import freeze_month, freeze_previous_month_for_all, report_for
from notifications.models import NotificationLog

from .conftest import at, stamp

pytestmark = pytest.mark.django_db

NOV = (date(2025, 11, 1), date(2025, 11, 30))
BASE = '/api/hr/teacher-performance/'


@pytest.fixture
def activity(perf):
    """Some real work in November 2025 so the scores are not all zero."""
    teacher = perf['staff'][0]
    ClassTeacherAssignment.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0], teacher=teacher,
    )
    student = perf['students'][0]
    for day, hour in ((3, 8), (4, 13), (5, 8)):
        d = date(2025, 11, day)
        rec = AttendanceRecord.objects.create(school=perf['school_a'], student=student, date=d, status='PRESENT')
        stamp(rec, created_at=at(d, hour))
        StaffAttendance.objects.create(school=perf['school_a'], staff_member=teacher, date=d, status='PRESENT')
    return teacher


def _strip(report):
    return json.loads(json.dumps(
        {'out_of': report['out_of'], 'teachers': report['teachers']}, default=str,
    ))


def test_frozen_month_equals_live(perf, activity):
    live = compute(perf['SID_A'], *NOV)
    freeze_month(perf['SID_A'], 2025, 11)
    frozen = report_for(perf['SID_A'], *NOV)
    assert frozen['snapshot'] is True
    assert _strip(frozen) == _strip(live)
    assert TeacherPerformanceSnapshot.objects.filter(school=perf['school_a']).count() == 3


def test_snapshot_survives_later_assignment_changes(perf, activity):
    freeze_month(perf['SID_A'], 2025, 11)
    before = report_for(perf['SID_A'], *NOV)['teachers']
    ClassTeacherAssignment.objects.all().delete()
    assert report_for(perf['SID_A'], *NOV)['teachers'] == before
    # A range that is not a whole month is always live, so it does change.
    live = report_for(perf['SID_A'], date(2025, 11, 1), date(2025, 11, 29))
    assert live['snapshot'] is False
    t = next(x for x in live['teachers'] if x['staff_id'] == activity.id)
    assert t['measures']['attendance_marking']['applicable'] is False


def test_refreezing_replaces_rows(perf, activity):
    freeze_month(perf['SID_A'], 2025, 11)
    freeze_month(perf['SID_A'], 2025, 11)
    assert TeacherPerformanceSnapshot.objects.filter(period_start=NOV[0]).count() == 3


def test_monthly_job_freezes_previous_month_and_notifies(perf, activity):
    done = freeze_previous_month_for_all(today=date(2025, 12, 1), school_ids=[perf['SID_A']])
    assert done == {perf['SID_A']: 3}
    logs = NotificationLog.objects.filter(school=perf['school_a'], channel='IN_APP', title='November 2025 performance report')
    assert logs.count() == 3
    body = logs.get(recipient_user=activity.user).body
    assert 'position' in body and 'November 2025' in body
    # The job does not create a settings row for a school that never opened its settings.
    assert not TeacherPerformanceConfig.objects.filter(school=perf['school_a']).exists()


def test_rank_left_out_of_message_when_hidden(perf, activity):
    TeacherPerformanceConfig.objects.create(school=perf['school_a'], show_rank_to_teachers=False)
    freeze_previous_month_for_all(today=date(2025, 12, 1), school_ids=[perf['SID_A']])
    body = NotificationLog.objects.get(recipient_user=activity.user).body
    assert 'position' not in body


def test_no_message_when_teachers_cannot_see_their_score(perf, activity):
    TeacherPerformanceConfig.objects.create(school=perf['school_a'], enabled=False)
    done = freeze_previous_month_for_all(today=date(2025, 12, 1), school_ids=[perf['SID_A']])
    assert done == {perf['SID_A']: 3}  # still frozen for admins
    assert not NotificationLog.objects.filter(school=perf['school_a']).exists()


def test_api_reads_the_snapshot_for_a_whole_month(perf, activity, api):
    freeze_month(perf['SID_A'], 2025, 11)
    TeacherPerformanceSnapshot.objects.filter(staff_member=activity).update(
        overall_score=12.5, breakdown={**TeacherPerformanceSnapshot.objects.get(staff_member=activity).breakdown, 'overall_score': 12.5},
    )
    body = api.get(f'{BASE}?start=2025-11-01&end=2025-11-30', perf['tokens']['admin'], perf['SID_A']).json()
    assert body['snapshot'] is True and body['frozen_at']
    assert next(t for t in body['teachers'] if t['staff_id'] == activity.id)['overall_score'] == 12.5

    token = api.login(activity.user.username)
    mine = api.get(f'{BASE}my/?start=2025-11-01&end=2025-11-30', token, perf['SID_A']).json()
    assert mine['snapshot'] is True and mine['teacher']['overall_score'] == 12.5


def test_manual_command_refreezes_a_named_month(perf, activity):
    call_command('run_scheduled_jobs', '--teacher-performance', '--school', str(perf['SID_A']), '--month', '2025-11')
    assert TeacherPerformanceSnapshot.objects.filter(period_start=NOV[0]).count() == 3
    assert not NotificationLog.objects.exists()  # a named-month re-freeze never messages teachers


def test_all_does_not_run_the_monthly_freeze(perf, activity):
    call_command('run_scheduled_jobs', '--all')
    assert not TeacherPerformanceSnapshot.objects.exists()
