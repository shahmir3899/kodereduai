"""Class attendance marked: class teacher owns each section's register; cut-off decides credit."""
import pytest

from academic_sessions.models import SchoolCalendarEntry
from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from hr.models import LeaveApplication

from .conftest import FRI, MON, SAT, THU, TUE, WED, at, measure, stamp

pytestmark = pytest.mark.django_db


def mark(student, day, saved_at):
    rec = AttendanceRecord.objects.create(
        school=student.school, student=student, date=day, status='PRESENT', source='MANUAL',
    )
    stamp(rec, created_at=saved_at)


@pytest.fixture
def class_teacher(perf):
    teacher = perf['staff'][0]
    ClassTeacherAssignment.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'],
        class_obj=perf['classes'][0], teacher=teacher,
    )
    return teacher


def test_on_time_late_next_day_and_missing(perf, class_teacher):
    s = perf['students'][0]
    mark(s, MON, at(MON, 8))            # before 11:00 -> full
    mark(s, TUE, at(TUE, 13))           # same day, after cut-off -> half
    mark(s, WED, at(THU, 9))            # next day -> none
    mark(s, FRI, at(FRI, 10, 59))       # full
    mark(s, SAT, at(SAT, 7))            # full; THU never marked
    m = measure(perf, 'attendance_marking')[class_teacher.id]
    assert m['due'] == 6
    assert m['done'] == 5
    assert m['on_time'] == 3
    assert m['score'] == pytest.approx(100 * 3.5 / 6, abs=0.1)
    reasons = {x['date']: x['reason'] for x in m['missed']}
    assert reasons[THU.isoformat()] == 'not marked'
    assert reasons[TUE.isoformat()].startswith('marked late')


def test_first_save_counts_not_a_later_resave(perf, class_teacher):
    s1, s2 = perf['students'][0], perf['students'][1]
    mark(s1, MON, at(MON, 8))
    mark(s2, MON, at(MON, 14))  # a correction later in the day does not make Monday late
    m = measure(perf, 'attendance_marking', MON, MON)[class_teacher.id]
    assert (m['due'], m['on_time'], m['score']) == (1, 1, 100)


def test_school_off_day_is_not_due(perf, class_teacher):
    SchoolCalendarEntry.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], name='Holiday',
        entry_kind='OFF_DAY', scope='SCHOOL', start_date=WED, end_date=THU,
    )
    m = measure(perf, 'attendance_marking')[class_teacher.id]
    assert m['due'] == 4


def test_class_scoped_off_day_only_frees_that_class(perf, class_teacher):
    other = SchoolCalendarEntry.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], name='Class 2 trip',
        entry_kind='OFF_DAY', scope='CLASS', start_date=MON, end_date=MON,
    )
    other.classes.add(perf['classes'][1])
    assert measure(perf, 'attendance_marking')[class_teacher.id]['due'] == 6
    other.classes.add(perf['classes'][0])
    assert measure(perf, 'attendance_marking')[class_teacher.id]['due'] == 5


def test_approved_leave_is_not_due_but_pending_leave_is(perf, class_teacher):
    LeaveApplication.objects.create(
        school=perf['school_a'], staff_member=class_teacher, start_date=MON, end_date=TUE,
        reason='x', status='APPROVED',
    )
    LeaveApplication.objects.create(
        school=perf['school_a'], staff_member=class_teacher, start_date=WED, end_date=WED,
        reason='x', status='PENDING',
    )
    assert measure(perf, 'attendance_marking')[class_teacher.id]['due'] == 4


def test_section_teacher_is_scored_on_their_own_section_only(perf, seed_sections):
    teacher = perf['staff'][1]
    ClassTeacherAssignment.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'],
        class_obj=seed_sections['master'], session_class=seed_sections['section_a'], teacher=teacher,
    )
    section_b_student = perf['students'][2]
    mark(section_b_student, MON, at(MON, 8))  # section B's register does not count for A
    m = measure(perf, 'attendance_marking', MON, MON)[teacher.id]
    assert (m['due'], m['done']) == (1, 0)
    mark(perf['students'][0], MON, at(MON, 8))
    m = measure(perf, 'attendance_marking', MON, MON)[teacher.id]
    assert (m['due'], m['done'], m['score']) == (1, 1, 100)


def test_teacher_without_a_class_does_not_have_the_measure(perf, class_teacher):
    m = measure(perf, 'attendance_marking')[perf['staff'][2].id]
    assert m['applicable'] is False and m['effective_weight'] == 0
