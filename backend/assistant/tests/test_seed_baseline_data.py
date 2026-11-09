"""The baseline seed command, run on the throwaway test database (never the real school)."""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

pytestmark = pytest.mark.django_db


def _run(seed, part, **kw):
    call_command('seed_baseline_data', school_id=seed['SID_A'], part=part, **kw)


def test_refuses_a_school_that_does_not_look_like_a_test_school(seed_data):
    school = seed_data['school_a']
    school.name = 'Green Valley Public School'
    school.save(update_fields=['name'])
    with pytest.raises(CommandError):
        _run(seed_data, 'a')


def test_part_a_builds_the_year_classes_people_and_time_data(seed_data):
    from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
    from attendance.models import AttendanceRecord
    from examinations.models import StudentMark
    from hr.models import LeaveApplication, StaffMember
    from parents.models import ParentChild
    from students.models import Class, Student

    _run(seed_data, 'a')
    sid = seed_data['SID_A']
    cur = AcademicYear.objects.get(school_id=sid, is_current=True)
    assert cur.name == 'BASE_2026-2027' and AcademicYear.objects.filter(school_id=sid, is_current=True).count() == 1
    assert Class.objects.filter(school_id=sid, name__in=['Class 4', 'Class 5', 'Class 6']).count() == 3
    assert SessionClass.objects.filter(school_id=sid, academic_year=cur, display_name='Class 5').count() == 2           # class 5 has sections A and B
    assert Student.objects.filter(school_id=sid, admission_number__startswith='BASE-').count() == 150
    assert StudentEnrollment.objects.filter(school_id=sid, academic_year=cur).count() == 150
    assert StaffMember.objects.filter(school_id=sid, employee_id__startswith='BASE-T').count() == 12
    assert 80 <= ParentChild.objects.filter(school_id=sid).count() <= 110
    assert AttendanceRecord.objects.filter(school_id=sid).count() > 15000
    assert StudentMark.objects.filter(school_id=sid).count() == 150 * 6
    assert LeaveApplication.objects.filter(school_id=sid, status='PENDING').count() == 3
    names = list(Student.objects.filter(school_id=sid, admission_number__startswith='BASE-').values_list('name', flat=True))
    assert len(names) - len(set(names)) >= 3 or any(n.startswith('Ali ') for n in names)           # repeated names on purpose


def test_every_part_is_safe_to_run_twice(seed_data):
    from students.models import Student
    for part in ('a', 'b', 'c'):
        _run(seed_data, part)
    before = Student.objects.filter(school_id=seed_data['SID_A']).count()
    for part in ('a', 'b', 'c'):
        _run(seed_data, part)
    assert Student.objects.filter(school_id=seed_data['SID_A']).count() == before


def test_part_b_and_c_add_money_and_operations_data(seed_data):
    from admissions.models import AdmissionEnquiry
    from finance.models import Expense, FeePayment
    from hostel.models import GatePass
    from hr.models import Payslip
    from inventory.models import InventoryItem
    from library.models import BookIssue
    from transport.models import TransportAssignment
    for part in ('a', 'b', 'c'):
        _run(seed_data, part)
    sid = seed_data['SID_A']
    unpaid = FeePayment.objects.filter(school_id=sid).exclude(status='PAID')
    assert FeePayment.objects.filter(school_id=sid).count() == 150 * 8 and unpaid.count() > 150
    assert Expense.objects.filter(school_id=sid).count() >= 30
    assert Payslip.objects.filter(school_id=sid, status='PAID').exists() and not Payslip.objects.filter(school_id=sid, month=11).exists()
    low = [i for i in InventoryItem.objects.filter(school_id=sid) if i.current_stock <= i.minimum_stock]
    assert len(low) >= 3
    assert BookIssue.objects.filter(school_id=sid, status='OVERDUE').count() == 3
    assert GatePass.objects.filter(school_id=sid, status='PENDING').count() == 4
    assert TransportAssignment.objects.filter(school_id=sid).count() == 30
    assert AdmissionEnquiry.objects.filter(school_id=sid).count() == 15


def test_dry_run_leaves_nothing_behind(seed_data):
    from students.models import Student
    _run(seed_data, 'a', dry_run=True)
    assert not Student.objects.filter(school_id=seed_data['SID_A'], admission_number__startswith='BASE-').exists()


def test_the_accounts_have_no_usable_password(seed_data):
    from users.models import User
    _run(seed_data, 'a')
    users = User.objects.filter(username__startswith='base_')
    assert users.exists() and not any(u.has_usable_password() for u in users)
