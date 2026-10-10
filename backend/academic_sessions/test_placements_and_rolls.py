"""Roll numbers (lowest free, active-only uniqueness, manual re-number) and dated
placements (a mid-year class move splits a student's history), plus the fee panel."""
import json
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction

from academic_sessions.models import (
    AcademicYear, EnrollmentPlacement, SessionClass, StudentEnrollment,
)
from academic_sessions.placement_service import placement_on
from academic_sessions.roll_allocator_service import RollAllocatorService
from attendance.models import AttendanceRecord
from core.models import AdminActionLog
from students.models import Student


def auth(ctx, token='admin'):
    return {'HTTP_AUTHORIZATION': f"Bearer {ctx['tokens'][token]}", 'HTTP_X_SCHOOL_ID': str(ctx['SID_A'])}


def post(api, ctx, url, body, token='admin'):
    return api.post(url, body, ctx['tokens'][token], ctx['SID_A'])


def get(api, ctx, url, token='admin'):
    return api.get(url, ctx['tokens'][token], ctx['SID_A'])


@pytest.fixture
def sections(seed_data, seed_sections):
    """Section A and B of Class_1A with two active students each, rolls reset to 1..2."""
    year = seed_data['academic_year']
    for position, student in enumerate(seed_sections['a_students'], start=1):
        StudentEnrollment.objects.filter(student=student, academic_year=year).update(roll_number=str(position))
    for position, student in enumerate(seed_sections['b_students'], start=1):
        StudentEnrollment.objects.filter(student=student, academic_year=year).update(roll_number=str(position))
    EnrollmentPlacement.objects.filter(student__in=[*seed_sections['a_students'], *seed_sections['b_students']]).delete()
    for enrollment in StudentEnrollment.objects.filter(academic_year=year, session_class__isnull=False):
        EnrollmentPlacement.objects.create(
            school=enrollment.school, enrollment=enrollment, student=enrollment.student,
            academic_year=year, session_class=enrollment.session_class, class_obj=enrollment.class_obj,
            roll_number=enrollment.roll_number, start_date=year.start_date,
        )
    return {**seed_data, **seed_sections, 'year': year}


def allocator(ctx, section):
    return RollAllocatorService(
        school_id=ctx['school_a'].id, academic_year_id=ctx['year'].id,
        class_obj_id=section.class_obj_id, session_class_id=section.id,
    )


@pytest.mark.django_db
class TestLowestFreeRoll:
    def test_fills_the_gap_a_leaver_left(self, sections):
        a = sections['section_a']
        # Section A holds rolls 1 and 2; roll 1's student leaves.
        leaver = sections['a_students'][0]
        StudentEnrollment.objects.filter(student=leaver).update(is_active=False, status='WITHDRAWN')
        assert allocator(sections, a).lowest_free_roll() == '1'

    def test_starts_the_sequence_when_there_are_no_gaps(self, sections):
        assert allocator(sections, sections['section_a']).lowest_free_roll() == '3'

    def test_a_requested_roll_wins_when_free_and_is_replaced_when_taken(self, sections):
        a = allocator(sections, sections['section_a'])
        assert a.resolve_roll('9') == '9'
        assert a.resolve_roll('2') == '3'

    def test_non_numeric_rolls_do_not_block_numbering(self, sections):
        StudentEnrollment.objects.filter(student=sections['a_students'][0]).update(roll_number='A12')
        assert allocator(sections, sections['section_a']).lowest_free_roll() == '1'


@pytest.mark.django_db
class TestActiveOnlyUniqueness:
    def test_a_closed_enrollment_no_longer_blocks_its_roll(self, sections):
        leaver, other = sections['a_students']
        StudentEnrollment.objects.filter(student=leaver).update(is_active=False, status='WITHDRAWN')
        newcomer = sections['students'][6]
        with transaction.atomic():
            StudentEnrollment.objects.create(
                school=sections['school_a'], student=newcomer, academic_year=sections['year'],
                class_obj=sections['master'], session_class=sections['section_a'],
                roll_number=StudentEnrollment.objects.get(student=leaver).roll_number,
            )

    def test_two_active_students_still_cannot_share_a_roll(self, sections):
        a_first = StudentEnrollment.objects.get(student=sections['a_students'][0])
        newcomer = sections['students'][6]
        with pytest.raises(IntegrityError), transaction.atomic():
            StudentEnrollment.objects.create(
                school=sections['school_a'], student=newcomer, academic_year=sections['year'],
                class_obj=sections['master'], session_class=sections['section_a'], roll_number=a_first.roll_number,
            )


@pytest.mark.django_db
class TestRenumber:
    def url(self, section):
        return f'/api/sessions/session-classes/{section.id}/renumber/'

    def test_preview_changes_nothing_and_lists_the_plan(self, api, sections):
        a = sections['section_a']
        StudentEnrollment.objects.filter(student=sections['a_students'][0]).update(roll_number='5')
        resp = post(api, sections, self.url(a), {'action': 'preview', 'order': 'roll'})
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert [(r['old_roll'], r['new_roll']) for r in body['changes']] == [('2', '1'), ('5', '2')]
        assert StudentEnrollment.objects.get(student=sections['a_students'][0]).roll_number == '5'

    def test_apply_swaps_rolls_without_a_collision_and_logs_it(self, api, sections):
        a = sections['section_a']
        first, second = sections['a_students']
        # Rolls 1 and 2 swap places: alphabetical order puts the later name first.
        Student.objects.filter(pk=first.pk).update(name='Zed')
        Student.objects.filter(pk=second.pk).update(name='Abe')
        resp = post(api, sections, self.url(a), {'action': 'apply', 'order': 'alphabetical'})
        assert resp.status_code == 200, resp.content
        assert StudentEnrollment.objects.get(student=second).roll_number == '1'
        assert StudentEnrollment.objects.get(student=first).roll_number == '2'
        assert Student.objects.get(pk=second.pk).roll_number == '1'
        assert AdminActionLog.objects.filter(action='section_renumbered', target_id=str(a.id)).exists()

    def test_apply_closes_gaps_and_skips_students_who_left(self, api, sections):
        a = sections['section_a']
        first, second = sections['a_students']
        StudentEnrollment.objects.filter(student=first).update(is_active=False, status='WITHDRAWN')
        StudentEnrollment.objects.filter(student=second).update(roll_number='7')
        resp = post(api, sections, self.url(a), {'action': 'apply', 'order': 'roll'})
        assert resp.status_code == 200, resp.content
        assert StudentEnrollment.objects.get(student=second).roll_number == '1'
        assert StudentEnrollment.objects.get(student=first).roll_number == '1'  # the leaver keeps theirs

    def test_manual_order_must_list_everyone(self, api, sections):
        a = sections['section_a']
        resp = post(api, sections, self.url(a), {'action': 'preview', 'order': 'manual', 'student_ids': [sections['a_students'][0].id]})
        assert resp.status_code == 400

    def test_manual_order_is_applied(self, api, sections):
        a = sections['section_a']
        ids = [s.id for s in reversed(sections['a_students'])]
        assert post(api, sections, self.url(a), {'action': 'apply', 'order': 'manual', 'student_ids': ids}).status_code == 200
        assert StudentEnrollment.objects.get(student_id=ids[0]).roll_number == '1'

    @pytest.mark.parametrize('token', ['teacher', 'manager', 'accountant'])
    def test_only_admins_can_renumber(self, api, sections, token):
        assert post(api, sections, self.url(sections['section_a']), {'action': 'apply'}, token=token).status_code == 403

    def test_attendance_warning_counts_records(self, api, sections):
        student = sections['a_students'][0]
        AttendanceRecord.objects.create(
            school=sections['school_a'], student=student, academic_year=sections['year'],
            date=sections['year'].start_date, status='PRESENT',
        )
        body = post(api, sections, self.url(sections['section_a']), {'action': 'preview', 'order': 'roll'}).json()
        assert body['attendance_records'] == 1


@pytest.mark.django_db
class TestPlacementSplit:
    def reclassify(self, api, ctx, student, target, **extra):
        body = {
            'academic_year_id': ctx['year'].id, 'target_session_class_id': target.id,
            'reason': 'Moved sections', **extra,
        }
        return post(api, ctx, f'/api/students/{student.id}/reclassify/', body)

    def test_new_enrollments_get_one_placement_covering_the_year(self, sections):
        placement = EnrollmentPlacement.objects.get(student=sections['a_students'][0])
        assert placement.start_date == sections['year'].start_date and placement.end_date is None

    def test_a_move_splits_the_year_at_the_effective_date(self, api, sections):
        student = sections['a_students'][0]
        effective = sections['year'].start_date + timedelta(days=30)
        resp = self.reclassify(api, sections, student, sections['section_b'], effective_date=effective.isoformat())
        assert resp.status_code == 200, resp.content

        placements = list(EnrollmentPlacement.objects.filter(student=student).order_by('start_date'))
        assert [p.session_class_id for p in placements] == [sections['section_a'].id, sections['section_b'].id]
        assert placements[0].end_date == effective and placements[1].start_date == effective
        assert placement_on(student.id, effective - timedelta(days=1)).session_class_id == sections['section_a'].id
        assert placement_on(student.id, effective).session_class_id == sections['section_b'].id
        enrollment = StudentEnrollment.objects.get(student=student)
        assert enrollment.session_class_id == sections['section_b'].id

    def test_the_new_section_gives_the_lowest_free_roll(self, api, sections):
        student = sections['a_students'][0]  # roll 1 in A
        StudentEnrollment.objects.filter(student=sections['b_students'][0]).update(roll_number='1')
        StudentEnrollment.objects.filter(student=sections['b_students'][1]).update(roll_number='3')
        self.reclassify(api, sections, student, sections['section_b'])
        assert StudentEnrollment.objects.get(student=student).roll_number == '2'

    def test_a_typed_roll_wins_when_free(self, api, sections):
        student = sections['a_students'][0]
        self.reclassify(api, sections, student, sections['section_b'], new_roll_number='40')
        assert StudentEnrollment.objects.get(student=student).roll_number == '40'

    def test_a_backdated_move_replaces_later_placements(self, api, sections):
        student = sections['a_students'][0]
        start = sections['year'].start_date
        self.reclassify(api, sections, student, sections['section_b'], effective_date=(start + timedelta(days=60)).isoformat())
        self.reclassify(api, sections, student, sections['section_a'], effective_date=(start + timedelta(days=20)).isoformat())
        placements = list(EnrollmentPlacement.objects.filter(student=student).order_by('start_date'))
        assert [p.session_class_id for p in placements] == [sections['section_a'].id, sections['section_a'].id]
        assert placements[0].end_date == start + timedelta(days=20)

    def test_same_section_with_a_roll_change_is_a_correction_not_a_split(self, api, sections):
        student = sections['a_students'][0]
        self.reclassify(api, sections, student, sections['section_a'], new_roll_number='30')
        assert EnrollmentPlacement.objects.filter(student=student).count() == 1
        assert EnrollmentPlacement.objects.get(student=student).roll_number == '30'

    def test_register_data_follows_the_student_by_date(self, api, sections):
        student = sections['a_students'][0]
        year = sections['year']
        month_start = year.start_date.replace(day=1)
        before, after = month_start + timedelta(days=2), month_start + timedelta(days=20)
        move_day = month_start + timedelta(days=10)
        for day in (before, after):
            AttendanceRecord.objects.create(
                school=sections['school_a'], student=student, academic_year=year, date=day, status='PRESENT',
            )
        assert self.reclassify(api, sections, student, sections['section_b'], effective_date=move_day.isoformat()).status_code == 200

        def register(section):
            url = (f"/api/attendance/records/register_data/?session_class_id={section.id}"
                   f"&date_from={month_start.isoformat()}&date_to={(month_start + timedelta(days=27)).isoformat()}"
                   f"&academic_year={year.id}")
            return {r['date'] for r in get(api, sections, url).json() if r['student_id'] == student.id}

        assert register(sections['section_a']) == {before.isoformat()}
        assert register(sections['section_b']) == {after.isoformat()}

    def test_the_register_roster_lists_a_moved_student_in_both_sections_for_that_month(self, api, sections):
        student = sections['a_students'][0]
        year = sections['year']
        month_start = year.start_date.replace(day=1)
        assert self.reclassify(
            api, sections, student, sections['section_b'], effective_date=(month_start + timedelta(days=10)).isoformat(),
        ).status_code == 200

        def roster(section, month):
            url = (f"/api/students/?session_class_id={section.id}&as_of_year={month.year}&as_of_month={month.month}"
                   f"&academic_year={year.id}&page_size=200")
            return {r['id'] for r in get(api, sections, url).json()['results']}

        assert student.id in roster(sections['section_a'], month_start)
        assert student.id in roster(sections['section_b'], month_start)
        next_month = (month_start + timedelta(days=40)).replace(day=1)
        assert student.id not in roster(sections['section_a'], next_month)
        assert student.id in roster(sections['section_b'], next_month)

    def test_an_enrollment_without_placements_still_shows_in_the_register(self, api, sections):
        """Rows created by code that predates placements fall back to the enrollment's section,
        even though the student has placements in another year."""
        student = sections['a_students'][0]
        year = sections['year']
        EnrollmentPlacement.objects.filter(student=student).delete()
        day = year.start_date + timedelta(days=3)
        AttendanceRecord.objects.create(
            school=sections['school_a'], student=student, academic_year=year, date=day, status='PRESENT',
        )
        other_year = AcademicYear.objects.create(
            school=sections['school_a'], name='Earlier', start_date=date(2023, 4, 1), end_date=date(2024, 3, 31),
        )
        enrollment = StudentEnrollment.objects.get(student=student, academic_year=year)
        EnrollmentPlacement.objects.create(
            school=enrollment.school, enrollment=enrollment, student=student, academic_year=other_year,
            session_class=None, class_obj=enrollment.class_obj, roll_number='1', start_date=other_year.start_date,
        )
        url = (f"/api/attendance/records/register_data/?session_class_id={sections['section_a'].id}"
               f"&date_from={day.replace(day=1).isoformat()}&date_to={(day.replace(day=1) + timedelta(days=27)).isoformat()}"
               f"&academic_year={year.id}")
        rows = get(api, sections, url).json()
        assert any(r['student_id'] == student.id for r in rows)

    def test_history_tab_lists_the_dated_placements(self, api, sections):
        student = sections['a_students'][0]
        self.reclassify(api, sections, student, sections['section_b'], effective_date=(sections['year'].start_date + timedelta(days=15)).isoformat())
        rows = get(api, sections, f'/api/students/{student.id}/enrollment_history/').json()
        placements = [p for row in rows for p in row['placements']]
        assert len(placements) == 2 and placements[0]['end_date'] == placements[1]['start_date']

    def test_a_reclassified_student_counts_as_having_history(self, api, sections):
        from students.lifecycle import student_has_history

        student = sections['a_students'][0]
        self.reclassify(api, sections, student, sections['section_b'], effective_date=(sections['year'].start_date + timedelta(days=15)).isoformat())
        assert student_has_history(student)

    def test_the_preview_warns_without_changing_anything(self, api, sections):
        student = sections['a_students'][0]
        year = sections['year']
        AttendanceRecord.objects.create(
            school=sections['school_a'], student=student, academic_year=year,
            date=year.start_date + timedelta(days=5), status='PRESENT',
        )
        url = (f"/api/students/{student.id}/reclassify-preview/?academic_year_id={year.id}"
               f"&target_session_class_id={sections['section_b'].id}&effective_date={year.start_date.isoformat()}")
        body = get(api, sections, url).json()
        assert body['warnings']['attendance_since'] == 1
        assert body['fees']['applies'] is False  # same master class: sections pay the same fees
        assert StudentEnrollment.objects.get(student=student).session_class_id == sections['section_a'].id


@pytest.mark.django_db
class TestFeesOnAMasterClassMove:
    @pytest.fixture
    def fees(self, sections):
        from finance.models import FeePayment, FeeStructure, MonthlyFeeCategory

        school, year = sections['school_a'], sections['year']
        old_class = sections['master']
        new_class = sections['classes'][1]
        category, _ = MonthlyFeeCategory.objects.get_or_create(school=school, name='Tuition')
        for klass, amount in ((old_class, '1000'), (new_class, '1500')):
            FeeStructure.objects.create(
                school=school, academic_year=year, class_obj=klass, fee_type='MONTHLY',
                monthly_category=category, monthly_amount=Decimal(amount), effective_from=year.start_date,
            )
        student = sections['a_students'][0]
        rows = []
        for offset in range(3):
            month = year.start_date.month + offset
            fee_year = year.start_date.year + (month - 1) // 12
            month = (month - 1) % 12 + 1
            rows.append(FeePayment.objects.create(
                school=school, student=student, academic_year=year, fee_type='MONTHLY',
                monthly_category=category, month=month, year=fee_year,
                base_monthly_fee=Decimal('1000'), amount_due=Decimal('1000') * (offset + 1),
                previous_balance=Decimal('1000') * offset,
            ))
        target = SessionClass.objects.create(
            school=school, academic_year=year, class_obj=new_class, display_name=new_class.name,
            section='A', grade_level=new_class.grade_level,
        )
        return {'student': student, 'rows': rows, 'target': target, 'category': category}

    def move(self, api, ctx, fees, **extra):
        return post(api, ctx, f"/api/students/{fees['student'].id}/reclassify/", {
            'academic_year_id': ctx['year'].id, 'target_session_class_id': fees['target'].id,
            'reason': 'Moved up', 'effective_date': ctx['year'].start_date.isoformat(), **extra,
        })

    def test_keep_leaves_generated_rows_alone(self, api, sections, fees):
        assert self.move(api, sections, fees, fee_option='keep').status_code == 200
        for row in fees['rows']:
            row.refresh_from_db()
            assert row.base_monthly_fee == Decimal('1000')

    def test_reprice_rebuilds_unpaid_months_with_the_carried_balance(self, api, sections, fees):
        resp = self.move(api, sections, fees, fee_option='reprice')
        assert resp.status_code == 200, resp.content
        due = []
        for row in fees['rows']:
            row.refresh_from_db()
            due.append((row.base_monthly_fee, row.amount_due))
        assert due == [
            (Decimal('1500'), Decimal('1500')),
            (Decimal('1500'), Decimal('3000')),
            (Decimal('1500'), Decimal('4500')),
        ]
        log = AdminActionLog.objects.filter(action='student_reclassified', target_id=str(fees['student'].id)).first()
        assert log.metadata['fee_option'] == 'reprice' and len(log.metadata['fee_changes']) == 3

    def test_reprice_is_refused_when_a_month_has_a_payment(self, api, sections, fees):
        from finance.models import FeePayment
        FeePayment.objects.filter(pk=fees['rows'][1].pk).update(amount_paid=Decimal('500'))
        resp = self.move(api, sections, fees, fee_option='reprice')
        assert resp.status_code == 400 and resp.json()['code'] == 'fees_cannot_be_repriced'
        assert StudentEnrollment.objects.get(student=fees['student']).session_class_id == sections['section_a'].id
        fees['rows'][0].refresh_from_db()
        assert fees['rows'][0].base_monthly_fee == Decimal('1000')

    def test_preview_shows_old_and_new_fee(self, api, sections, fees):
        url = (f"/api/students/{fees['student'].id}/reclassify-preview/?academic_year_id={sections['year'].id}"
               f"&target_session_class_id={fees['target'].id}&effective_date={sections['year'].start_date.isoformat()}")
        body = get(api, sections, url).json()['fees']
        assert body['applies'] is True and body['can_reprice'] is True
        tuition = next(c for c in body['categories'] if c['name'] == 'Tuition')
        assert (tuition['old_fee'], tuition['new_fee']) == ('1000.00', '1500.00')
        assert len(tuition['months_from_move']) == 3
