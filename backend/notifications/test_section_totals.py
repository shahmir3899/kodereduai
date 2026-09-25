"""
Fee notification totals and report labels are per section.

Grouping by the Student.class_obj snapshot pooled both sections of a master
class into one total, and a section A class teacher was sent section B's
overdue amounts too. Builds on seed_data/seed_sections.
"""
from datetime import date
from decimal import Decimal

import pytest

from academics.models import ClassTeacherAssignment
from finance.models import FeePayment, MonthlyFeeCategory
from notifications.models import NotificationLog
from notifications.triggers import trigger_fee_overdue_in_app, trigger_fee_pending_in_app
from reports.generators.fee import FeeCollectionReportGenerator, FeeDefaultersReportGenerator


pytestmark = pytest.mark.django_db


@pytest.fixture
def unpaid(seed_data, seed_sections):
    """May 2025 fees: section A student owes 1000, section B student 3000."""
    category = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Tuition', is_active=True)
    for student, due in ((seed_sections['a_students'][0], '1000'), (seed_sections['b_students'][0], '3000')):
        FeePayment.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            fee_type='MONTHLY', monthly_category=category,
            month=5, year=2025, amount_due=Decimal(due), amount_paid=Decimal('0'),
        )
    teacher_a = seed_data['staff'][0]
    ClassTeacherAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        session_class=seed_sections['section_a'], class_obj=seed_sections['master'], teacher=teacher_a,
    )
    return {'teacher_a_user': teacher_a.user}


def _sent(user, event_type):
    return list(NotificationLog.objects.filter(recipient_user=user, event_type=event_type).values_list('title', 'body'))


def test_fee_pending_admin_totals_are_per_section(seed_data, seed_sections, unpaid):
    trigger_fee_pending_in_app(seed_data['school_a'], month=5, year=2025)

    titles = sorted(t for t, _ in _sent(seed_data['users']['admin'], 'FEE_DUE'))
    assert titles == [
        f"Fee Pending — {seed_sections['section_a'].label}",
        f"Fee Pending — {seed_sections['section_b'].label}",
    ]


def test_fee_overdue_section_teacher_gets_only_their_section(seed_data, seed_sections, unpaid):
    trigger_fee_overdue_in_app(seed_data['school_a'], as_of=date(2025, 7, 1))

    sent = _sent(unpaid['teacher_a_user'], 'FEE_OVERDUE')
    assert len(sent) == 1
    title, body = sent[0]
    assert seed_sections['section_a'].label in title
    assert 'Rs 1,000' in body


def test_defaulters_report_lists_fully_unpaid_students(seed_data, unpaid):
    data = FeeDefaultersReportGenerator(seed_data['school_a'], {
        'month': 5, 'year': 2025, 'academic_year': seed_data['academic_year'].id,
    }).get_data()

    assert len(data['table_rows']) == 2


def test_fee_report_rows_are_per_section(seed_data, seed_sections, unpaid):
    data = FeeCollectionReportGenerator(seed_data['school_a'], {
        'month': 5, 'year': 2025, 'academic_year': seed_data['academic_year'].id,
    }).get_data()

    labels = sorted(str(row[0]) for row in data['table_rows'])
    assert labels == sorted([seed_sections['section_a'].label, seed_sections['section_b'].label])
