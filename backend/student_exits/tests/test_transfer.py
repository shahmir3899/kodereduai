"""A mid-year transfer: the student gets a new record at the destination branch, and
whatever the family still owes becomes that branch's to collect.

Worked example (Tuition + one annual fee), as in finance/test_student_fee_summary.py:

    Tuition   Jan  due 1000  paid   0
              Feb  due 2000  paid 500   (carries Jan)   -> owed 1500
    Annual    fee  due  800  paid 300                    -> owed  500
    Owed in total: 2000. Leaving date 2026-03-01.
"""
from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.models import StudentEnrollment
from finance.models import AnnualFeeCategory, FeePayment, MonthlyFeeCategory
from finance.student_balance import student_pending_fees
from finance.tasks import _is_annual_conflict, _is_monthly_conflict
from finance.views import _get_previous_month_balance
from parents.models import ParentChild, ParentProfile
from schools.models import UserSchoolMembership
from student_exits import services
from student_exits.models import EnrollmentBreak, ExitClearanceItem, StudentExit
from students.models import Student
from users.models import User

from .test_exit_workflow import LEAVING, URL, _account, category, ctx, monthly_payment, start  # noqa: F401
from .transfer_helpers import destination_placement, placement_body


@pytest.fixture
def dest(ctx):
    return destination_placement(ctx)


def start_transfer(api, ctx, dest, **overrides):
    body = {'exit_type': 'TRANSFERRED', 'destination_school': ctx['SID_B'], **placement_body(dest)}
    body.update(overrides)
    return start(api, ctx, **body)


def post(api, ctx, exit_id, action, body=None):
    return api.post(f'{URL}{exit_id}/{action}', body or {}, ctx['tokens']['admin'], ctx['SID_A'])


def finalize(api, ctx, exit_id):
    return post(api, ctx, exit_id, 'finalize/')


def carry(api, ctx, exit_id):
    return post(api, ctx, exit_id, 'items/FEES/carry/')


def annual_payment(ctx, due, paid, year=2026):
    paid = Decimal(paid)
    category, _ = AnnualFeeCategory.objects.get_or_create(school=ctx['school_a'], name='Admission Drive')
    extra = {'payment_date': date(year, 1, 5), 'account': _account(ctx)} if paid else {}
    return FeePayment.objects.create(
        school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
        fee_type='ANNUAL', annual_category=category, month=0, year=year,
        amount_due=Decimal(due), amount_paid=paid, status='PARTIAL' if paid else 'UNPAID', **extra,
    )


def worked_example(ctx, category):
    monthly_payment(ctx, category, 1, '1000', '0')
    feb = monthly_payment(ctx, category, 2, '2000', '500')
    feb.previous_balance, feb.base_monthly_fee = Decimal('1000'), Decimal('1000')
    feb.save()
    annual_payment(ctx, '800', '300')


def new_student(exit_id):
    return StudentExit.objects.get(pk=exit_id).destination_student


# ── The new student record ───────────────────────────────────────────────────

@pytest.mark.django_db
class TestNewRecordAtTheDestination:
    def test_finalizing_creates_the_student_at_the_new_branch(self, api, ctx, dest):
        source = ctx['student']
        exit_id = start_transfer(api, ctx, dest).json()['id']
        assert finalize(api, ctx, exit_id).status_code == 200

        created = new_student(exit_id)
        assert created.school_id == ctx['SID_B'] and created.id != source.id
        assert created.transferred_from_id == source.id
        assert created.name == source.name and created.parent_phone == source.parent_phone
        assert created.roll_number == dest['roll'] and created.class_obj_id == dest['master'].id
        assert created.status == 'ACTIVE' and created.admission_date == LEAVING
        assert created.previous_school == ctx['school_a'].name

    def test_the_new_student_is_enrolled_in_the_chosen_class_and_roll(self, api, ctx, dest):
        exit_id = start_transfer(api, ctx, dest).json()['id']
        finalize(api, ctx, exit_id)
        enrollment = StudentEnrollment.objects.get(student=new_student(exit_id))
        assert (enrollment.school_id, enrollment.session_class_id, enrollment.roll_number) == (
            ctx['SID_B'], dest['session_class'].id, dest['roll'])
        assert enrollment.is_active and enrollment.academic_year_id == dest['year'].id

    def test_the_student_stays_visible_at_the_old_branch_until_the_leaving_date(self, api, ctx, dest):
        source = ctx['student']
        exit_id = start_transfer(api, ctx, dest).json()['id']
        finalize(api, ctx, exit_id)
        source.refresh_from_db()
        old = StudentEnrollment.objects.get(student=source, school=ctx['school_a'])
        assert source.school_id == ctx['SID_A'] and source.status == 'TRANSFERRED'
        assert old.left_date == LEAVING and not old.is_active

    def test_the_days_before_they_joined_are_excluded_at_the_new_branch(self, api, ctx, dest):
        exit_id = start_transfer(api, ctx, dest).json()['id']
        finalize(api, ctx, exit_id)
        brk = EnrollmentBreak.objects.get(student=new_student(exit_id))
        assert (brk.school_id, brk.start_date, brk.end_date) == (ctx['SID_B'], dest['year'].start_date, LEAVING)
        assert 'Joined from' in brk.reason

    def test_parents_follow_the_child(self, api, ctx, dest):
        parent_user = User.objects.create_user(
            username='SEED_transfer_parent', email='tp@test.com', password=ctx['password'], role='PARENT',
            school=ctx['school_a'], organization=ctx['org'],
        )
        profile = ParentProfile.objects.create(user=parent_user, phone='+923001112223')
        ParentChild.objects.create(parent=profile, student=ctx['student'], school=ctx['school_a'],
                                   relation='FATHER', is_primary=True)
        exit_id = start_transfer(api, ctx, dest).json()['id']
        finalize(api, ctx, exit_id)
        created = new_student(exit_id)
        link = ParentChild.objects.get(student=created)
        assert link.school_id == ctx['SID_B'] and link.parent_id == profile.id and link.is_primary
        assert UserSchoolMembership.objects.filter(user=parent_user, school=ctx['school_b'], is_active=True).exists()
        assert ParentChild.objects.filter(student=ctx['student']).exists()   # still read-only at the old branch

    def test_the_exit_remembers_the_new_record_and_what_was_done(self, api, ctx, dest):
        exit_id = start_transfer(api, ctx, dest).json()['id']
        body = finalize(api, ctx, exit_id).json()
        assert body['destination_student'] == new_student(exit_id).id
        assert body['snapshot']['transfer']['roll_number'] == dest['roll']
        assert body['snapshot']['transfer']['fees_carried'] is None

    def test_it_is_all_or_nothing(self, api, ctx, dest, monkeypatch):
        from student_exits import transfer
        exit_id = start_transfer(api, ctx, dest).json()['id']

        def boom(*args, **kwargs):
            raise RuntimeError('database went away')
        monkeypatch.setattr(transfer, '_copy_parent_links', boom)
        with pytest.raises(RuntimeError):
            finalize(api, ctx, exit_id)
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'ACTIVE'
        assert not Student.objects.filter(transferred_from=ctx['student']).exists()
        assert StudentExit.objects.get(pk=exit_id).status == 'OPEN'


# ── Choosing the class and roll ──────────────────────────────────────────────

@pytest.mark.django_db
class TestPlacementRules:
    def test_a_transfer_cannot_be_finalized_without_a_class_at_the_new_branch(self, api, ctx):
        exit_id = start(api, ctx, exit_type='TRANSFERRED', destination_school=ctx['SID_B']).json()['id']
        resp = finalize(api, ctx, exit_id)
        assert resp.status_code == 400 and 'class' in resp.json()['detail'].lower()
        assert not Student.objects.filter(transferred_from=ctx['student']).exists()

    def test_a_class_from_another_branch_is_refused(self, api, ctx, dest):
        own = ctx['classes'][0]
        from academic_sessions.models import SessionClass
        mine = SessionClass.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], class_obj=own,
            display_name=own.name, section='Z', grade_level=1,
        )
        resp = start(api, ctx, exit_type='TRANSFERRED', destination_school=ctx['SID_B'],
                     destination_session_class=mine.id, destination_roll_number='1')
        assert resp.status_code == 400

    def test_a_roll_already_taken_in_that_class_is_refused(self, api, ctx, dest):
        other = Student.objects.create(
            school=ctx['school_b'], class_obj=dest['master'], roll_number=dest['roll'], name='PYTEST_Other',
        )
        StudentEnrollment.objects.create(
            school=ctx['school_b'], student=other, academic_year=dest['year'],
            class_obj=dest['master'], session_class=dest['session_class'], roll_number=dest['roll'],
        )
        resp = start_transfer(api, ctx, dest)
        assert resp.status_code == 400 and 'already taken' in resp.json()['detail']

    def test_a_class_and_roll_can_be_chosen_after_the_exit_was_opened(self, api, ctx, dest):
        exit_id = start(api, ctx, exit_type='TRANSFERRED', destination_school=ctx['SID_B']).json()['id']
        resp = api.patch(f'{URL}{exit_id}/', placement_body(dest), ctx['tokens']['admin'], ctx['SID_A'])
        body = resp.json()
        assert resp.status_code == 200
        assert body['destination_session_class'] == dest['session_class'].id and body['destination_roll_number'] == dest['roll']
        assert body['destination_class_label']

    def test_changing_the_branch_clears_the_class_picked_for_the_old_one(self, api, ctx, dest):
        from schools.models import School
        exit_id = start_transfer(api, ctx, dest).json()['id']
        other = School.objects.create(
            organization=ctx['org'], name='PYTEST_Gamma', subdomain='pytest-gamma', is_active=True,
        )
        resp = api.patch(f'{URL}{exit_id}/', {'destination_school': other.id}, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200 and resp.json()['destination_session_class'] is None

    def test_a_class_at_the_new_branch_is_refused_for_a_withdrawal(self, api, ctx, dest):
        resp = start(api, ctx, **placement_body(dest))
        assert resp.status_code == 400

    def test_the_wizard_can_list_the_classes_and_taken_rolls(self, api, ctx, dest):
        other = Student.objects.create(
            school=ctx['school_b'], class_obj=dest['master'], roll_number='3', name='PYTEST_Taken',
        )
        StudentEnrollment.objects.create(
            school=ctx['school_b'], student=other, academic_year=dest['year'],
            class_obj=dest['master'], session_class=dest['session_class'], roll_number='3',
        )
        resp = api.get(f"{URL}destination-classes/?school={ctx['SID_B']}&leaving_date={LEAVING.isoformat()}",
                       ctx['tokens']['admin'], ctx['SID_A'])
        body = resp.json()
        assert resp.status_code == 200 and body['academic_year']['id'] == dest['year'].id
        entry = next(c for c in body['classes'] if c['id'] == dest['session_class'].id)
        assert entry['rolls'] == ['3']

    def test_the_class_list_is_refused_for_a_branch_of_another_organization(self, api, ctx):
        from schools.models import Organization, School
        org = Organization.objects.create(name='PYTEST_Outside_Org', slug='pytest-outside-org')
        outside = School.objects.create(name='PYTEST_Outside', subdomain='pytest-outside', organization=org)
        resp = api.get(f'{URL}destination-classes/?school={outside.id}&leaving_date={LEAVING.isoformat()}',
                       ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 400


# ── The fees ─────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestCarryingTheFees:
    def test_the_preview_shows_each_charge_as_the_new_branch_will_see_it(self, api, ctx, dest, category):
        worked_example(ctx, category)
        plan = start_transfer(api, ctx, dest).json()['fee_carry_plan']
        assert plan['destination'] == ctx['school_b'].name and Decimal(plan['total']) == Decimal('2000')
        by_type = {line['fee_type']: line for line in plan['lines']}
        assert Decimal(by_type['MONTHLY']['balance']) == Decimal('1500') and by_type['MONTHLY']['label'] == 'Tuition'
        assert Decimal(by_type['ANNUAL']['balance']) == Decimal('500')
        assert by_type['MONTHLY']['category_exists'] is False   # Beta has no 'Tuition' yet

    def test_no_preview_when_nothing_is_pending(self, api, ctx, dest):
        assert start_transfer(api, ctx, dest).json()['fee_carry_plan'] is None

    def test_carrying_clears_the_fee_item_without_a_waiver_reason(self, api, ctx, dest, category):
        worked_example(ctx, category)
        exit_id = start_transfer(api, ctx, dest).json()['id']
        body = carry(api, ctx, exit_id).json()
        fees = next(i for i in body['items'] if i['kind'] == 'FEES')
        assert fees['state'] == 'CARRIED' and body['open_item_count'] == 0
        assert finalize(api, ctx, exit_id).status_code == 200

    def test_finalizing_creates_the_charges_at_the_new_branch(self, api, ctx, dest, category):
        worked_example(ctx, category)
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)

        created = new_student(exit_id)
        rows = FeePayment.objects.filter(student=created)
        assert rows.count() == 2 and all(r.school_id == ctx['SID_B'] and r.carried_from_exit_id == exit_id for r in rows)
        monthly = rows.get(fee_type='MONTHLY')
        assert monthly.amount_due == Decimal('1500') and monthly.amount_paid == Decimal('0')
        assert monthly.previous_balance == Decimal('1500')
        assert monthly.monthly_category.name == 'Tuition' and monthly.monthly_category.school_id == ctx['SID_B']
        annual = rows.get(fee_type='ANNUAL')
        assert (annual.amount_due, annual.annual_category.name) == (Decimal('500'), 'Admission Drive')
        assert student_pending_fees(created)['total'] == Decimal('2000')

    def test_the_old_branch_no_longer_owes_it_and_nothing_was_paid_or_deleted(self, api, ctx, dest, category):
        worked_example(ctx, category)
        before = list(FeePayment.objects.filter(student=ctx['student']).values_list('amount_due', 'amount_paid'))
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)

        assert student_pending_fees(ctx['student'])['total'] == Decimal('0')
        after = list(FeePayment.objects.filter(student=ctx['student']).values_list('amount_due', 'amount_paid'))
        assert sorted(before) == sorted(after)
        assert FeePayment.objects.filter(student=ctx['student'], handed_over_to_exit_id=exit_id).count() == 2

    def test_the_total_owed_is_the_same_before_and_after(self, api, ctx, dest, category):
        worked_example(ctx, category)
        owed_before = student_pending_fees(ctx['student'])['total']
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        owed_after = student_pending_fees(ctx['student'])['total'] + student_pending_fees(new_student(exit_id))['total']
        assert owed_before == owed_after == Decimal('2000')

    def test_the_new_branchs_next_month_continues_from_the_carried_balance(self, api, ctx, dest, category):
        worked_example(ctx, category)
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        created = new_student(exit_id)
        tuition = created.fee_payments.get(fee_type='MONTHLY').monthly_category
        # The opening row is February (the last month billed); March bills on top of it.
        row = created.fee_payments.get(fee_type='MONTHLY')
        assert (row.year, row.month) == (2026, 2)
        assert _get_previous_month_balance(
            school_id=ctx['SID_B'], student_id=created.id, month=3, year=2026, monthly_category_id=tuition.id,
        ) == Decimal('1500')

    def test_when_the_old_branch_last_billed_long_ago_the_row_still_sits_right_before_joining(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 1, '1000', '0')              # nothing since January
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        row = new_student(exit_id).fee_payments.get(fee_type='MONTHLY')
        assert (row.year, row.month) == (2026, 2)                  # the month before the leaving month (March)

    def test_the_annual_row_exists_only_when_something_is_pending(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 1, '1000', '0')
        annual_payment(ctx, '800', '800')                           # fully paid
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        assert list(new_student(exit_id).fee_payments.values_list('fee_type', flat=True)) == ['MONTHLY']

    def test_an_annual_only_balance_carries_without_a_monthly_row(self, api, ctx, dest):
        annual_payment(ctx, '800', '300')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        assert list(new_student(exit_id).fee_payments.values_list('fee_type', flat=True)) == ['ANNUAL']

    def test_existing_categories_at_the_new_branch_are_reused_not_duplicated(self, api, ctx, dest, category):
        existing = MonthlyFeeCategory.objects.create(school=ctx['school_b'], name='tuition')
        monthly_payment(ctx, category, 2, '1000', '0')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        plan = api.get(f'{URL}{exit_id}/', ctx['tokens']['admin'], ctx['SID_A']).json()['fee_carry_plan']
        assert plan['lines'][0]['category_exists'] is True
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        assert new_student(exit_id).fee_payments.get().monthly_category_id == existing.id
        assert MonthlyFeeCategory.objects.filter(school=ctx['school_b']).count() == 1

    def test_credits_are_not_carried(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 2, '1000', '1000')           # paid in full
        exit_id = start_transfer(api, ctx, dest).json()['id']
        assert api.get(f'{URL}{exit_id}/', ctx['tokens']['admin'], ctx['SID_A']).json()['fee_carry_plan'] is None

    def test_the_carried_rows_are_never_overwritten_by_fee_generation(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        annual_payment(ctx, '800', '0')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        finalize(api, ctx, exit_id)
        for row in new_student(exit_id).fee_payments.all():
            assert _is_monthly_conflict(row, Decimal('0'), Decimal('500'), Decimal('500')) is False
            assert _is_annual_conflict(row, Decimal('1')) is False


@pytest.mark.django_db
class TestCarryRules:
    def test_only_a_transfer_can_carry(self, api, ctx, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        exit_id = start(api, ctx).json()['id']                     # a withdrawal
        resp = carry(api, ctx, exit_id)
        assert resp.status_code == 400 and 'transfer' in resp.json()['detail'].lower()

    def test_nothing_to_carry_when_nothing_is_pending(self, api, ctx, dest):
        exit_id = start_transfer(api, ctx, dest).json()['id']
        assert carry(api, ctx, exit_id).status_code == 400

    def test_only_fees_can_be_carried(self, api, ctx, dest):
        exit_id = start_transfer(api, ctx, dest).json()['id']
        assert post(api, ctx, exit_id, 'items/LIBRARY/carry/').status_code == 400

    def test_carrying_can_be_undone(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        body = post(api, ctx, exit_id, 'items/FEES/unwaive/').json()
        assert next(i for i in body['items'] if i['kind'] == 'FEES')['state'] == 'OPEN'

    def test_the_old_options_still_work_for_a_transfer(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        resp = post(api, ctx, exit_id, 'items/FEES/waive/', {'reason': 'Branch will collect it later on'})
        assert resp.status_code == 200
        assert finalize(api, ctx, exit_id).status_code == 200
        created = new_student(exit_id)
        assert created.fee_payments.count() == 0                      # waived, not carried
        assert student_pending_fees(ctx['student'])['total'] == Decimal('1000')   # still owed at the old branch

    def test_the_decision_lapses_when_the_fees_change_afterwards(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        monthly_payment(ctx, category, 3, '2000', '0')                # another month billed meanwhile
        body = post(api, ctx, exit_id, 'refresh/').json()
        assert next(i for i in body['items'] if i['kind'] == 'FEES')['state'] == 'OPEN'
        assert finalize(api, ctx, exit_id).status_code == 400

    def test_cancelling_creates_nothing(self, api, ctx, dest, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        exit_id = start_transfer(api, ctx, dest).json()['id']
        carry(api, ctx, exit_id)
        post(api, ctx, exit_id, 'cancel/', {'reason': 'Changed their mind'})
        assert not Student.objects.filter(transferred_from=ctx['student']).exists()
        assert not FeePayment.objects.filter(carried_from_exit_id=exit_id).exists()
        assert student_pending_fees(ctx['student'])['total'] == Decimal('1000')

    def test_a_withdrawal_creates_no_new_record(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        assert finalize(api, ctx, exit_id).status_code == 200
        assert not Student.objects.filter(transferred_from=ctx['student']).exists()
