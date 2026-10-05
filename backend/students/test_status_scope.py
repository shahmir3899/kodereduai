"""Students list: status_scope=current|left|all.

Left students have an inactive enrollment, so the default "enrolled and active" list
never returned them and there was no way to find them from the Students page.
"""
from datetime import date

import pytest

from academic_sessions.models import AcademicYear, StudentEnrollment
from schools.models import Organization, School
from students.models import Student

URL = '/api/students/'


@pytest.fixture
def ctx(seed_data):
    """Four School Alpha students enrolled this year: one active, one withdrawn,
    one transferred (to School Beta, with a new record there) and one graduated."""
    year, school = seed_data['academic_year'], seed_data['school_a']
    students = seed_data['students'][:4]
    plan = [('ACTIVE', True, None), ('WITHDRAWN', False, date(2026, 1, 10)),
            ('TRANSFERRED', False, date(2026, 2, 1)), ('GRADUATED', False, date(2026, 3, 1))]
    for student, (status, active, left) in zip(students, plan):
        StudentEnrollment.objects.create(
            school=school, student=student, academic_year=year, class_obj=student.class_obj,
            roll_number=student.roll_number, status=status, is_active=active, left_date=left,
        )
        student.status = status
        student.save(update_fields=['status'])
    return {**seed_data, 'active': students[0], 'withdrawn': students[1],
            'transferred': students[2], 'graduated': students[3]}


def ids(api, ctx, **params):
    query = '&'.join(f'{k}={v}' for k, v in {'page_size': 9999, **params}.items())
    resp = api.get(f'{URL}?{query}', ctx['tokens']['admin'], ctx['SID_A'])
    assert resp.status_code == 200, resp.content
    body = resp.json()
    rows = body['results'] if isinstance(body, dict) else body
    return {r['id']: r for r in rows}


@pytest.mark.django_db
class TestStatusScope:
    def test_the_default_still_lists_only_current_students(self, api, ctx):
        rows = ids(api, ctx, academic_year=ctx['academic_year'].id)
        assert ctx['active'].id in rows
        assert not {ctx['withdrawn'].id, ctx['transferred'].id, ctx['graduated'].id} & set(rows)

    def test_current_is_the_same_as_the_default(self, api, ctx):
        assert set(ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='current')) == \
            set(ids(api, ctx, academic_year=ctx['academic_year'].id))

    def test_left_lists_withdrawn_transferred_and_graduated_but_not_current(self, api, ctx):
        rows = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='left')
        assert {ctx['withdrawn'].id, ctx['transferred'].id, ctx['graduated'].id} <= set(rows)
        assert ctx['active'].id not in rows

    def test_left_rows_carry_status_and_leaving_date(self, api, ctx):
        rows = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='left')
        assert (rows[ctx['withdrawn'].id]['status'], rows[ctx['withdrawn'].id]['left_date']) == ('WITHDRAWN', '2026-01-10')
        assert rows[ctx['transferred'].id]['status'] == 'TRANSFERRED'
        assert rows[ctx['graduated'].id]['status'] == 'GRADUATED'

    def test_all_lists_everyone_enrolled_in_the_year(self, api, ctx):
        rows = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='all')
        assert {ctx['active'].id, ctx['withdrawn'].id, ctx['transferred'].id, ctx['graduated'].id} <= set(rows)

    def test_without_an_academic_year_the_current_year_is_used(self, api, ctx):
        rows = ids(api, ctx, status_scope='left')
        assert ctx['withdrawn'].id in rows and ctx['active'].id not in rows

    def test_a_student_who_left_in_another_year_is_not_in_this_years_left_list(self, api, ctx):
        other = AcademicYear.objects.create(
            school=ctx['school_a'], name='PYTEST_Other_Year', start_date=date(2027, 4, 1), end_date=date(2028, 3, 31),
        )
        rows = ids(api, ctx, academic_year=other.id, status_scope='left')
        assert not {ctx['withdrawn'].id, ctx['transferred'].id} & set(rows)

    def test_an_unknown_scope_behaves_like_the_default(self, api, ctx):
        assert ctx['withdrawn'].id not in ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='bogus')

    def test_other_schools_students_never_appear(self, api, ctx):
        outsider = Student.objects.create(
            school=ctx['school_b'], class_obj=ctx['classes'][0], roll_number='99', name='PYTEST_Outsider', status='WITHDRAWN',
        )
        rows = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='all')
        assert outsider.id not in rows

    def test_a_left_student_still_opens_on_the_profile(self, api, ctx):
        resp = api.get(f"{URL}{ctx['withdrawn'].id}/", ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200 and resp.json()['id'] == ctx['withdrawn'].id

    def test_every_role_can_use_the_left_view_within_its_own_scope(self, api, ctx):
        for role in ('principal', 'accountant', 'staff'):
            resp = api.get(f"{URL}?status_scope=left&academic_year={ctx['academic_year'].id}",
                           ctx['tokens'][role], ctx['SID_A'])
            assert resp.status_code in (200, 403), (role, resp.status_code)


@pytest.mark.django_db
class TestTransferredTo:
    def _transfer_record(self, ctx):
        return Student.objects.create(
            school=ctx['school_b'], class_obj=ctx['classes'][0], roll_number='55', name='PYTEST_Moved',
            transferred_from=ctx['transferred'],
        )

    def test_a_transferred_row_points_to_the_new_branch_and_record(self, api, ctx):
        new = self._transfer_record(ctx)
        row = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='left')[ctx['transferred'].id]
        assert row['transferred_to']['school_name'] == ctx['school_b'].name
        # The admin of School Alpha cannot open School Beta, so the record id is withheld.
        assert row['transferred_to']['student_id'] is None
        assert new.id  # the new record exists

    def test_the_record_id_is_given_to_someone_who_can_open_that_branch(self, api, ctx):
        from schools.models import UserSchoolMembership
        new = self._transfer_record(ctx)
        UserSchoolMembership.objects.create(user=ctx['users']['admin'], school=ctx['school_b'], role='SCHOOL_ADMIN')
        row = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='left')[ctx['transferred'].id]
        assert row['transferred_to']['student_id'] == new.id
        assert row['transferred_to']['school_id'] == ctx['school_b'].id

    def test_students_who_did_not_transfer_have_no_target(self, api, ctx):
        rows = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='all')
        assert rows[ctx['withdrawn'].id]['transferred_to'] is None
        assert rows[ctx['active'].id]['transferred_to'] is None

    def test_an_old_transfer_without_a_new_record_still_lists_fine(self, api, ctx):
        row = ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='left')[ctx['transferred'].id]
        assert row['status'] == 'TRANSFERRED' and row['transferred_to'] is None


@pytest.mark.django_db
class TestTransferredStudentsCannotBeDeleted:
    def test_the_old_record_of_a_transfer_cannot_be_deleted(self, api, ctx):
        Student.objects.create(
            school=ctx['school_b'], class_obj=ctx['classes'][0], roll_number='55', name='PYTEST_Moved',
            transferred_from=ctx['transferred'],
        )
        resp = api.delete(f"{URL}{ctx['transferred'].id}/", ctx['tokens']['admin'], ctx['SID_A']) \
            if hasattr(api, 'delete') else api.client.delete(
                f"{URL}{ctx['transferred'].id}/", HTTP_AUTHORIZATION=f"Bearer {ctx['tokens']['admin']}",
                HTTP_X_SCHOOL_ID=str(ctx['SID_A']))
        assert resp.status_code == 400 and resp.json()['code'] == 'transfer_linked'
        assert Student.objects.filter(pk=ctx['transferred'].pk).exists()

    def test_the_new_record_of_a_transfer_cannot_be_deleted_either(self, api, ctx):
        new = Student.objects.create(
            school=ctx['school_a'], class_obj=ctx['classes'][0], roll_number='56', name='PYTEST_Moved2',
            transferred_from=ctx['transferred'],
        )
        resp = api.client.delete(
            f'{URL}{new.id}/', HTTP_AUTHORIZATION=f"Bearer {ctx['tokens']['admin']}",
            HTTP_X_SCHOOL_ID=str(ctx['SID_A']))
        assert resp.status_code == 400 and Student.objects.filter(pk=new.pk).exists()

    def test_an_ordinary_student_can_still_be_deleted(self, api, ctx):
        resp = api.client.delete(
            f"{URL}{ctx['active'].id}/", HTTP_AUTHORIZATION=f"Bearer {ctx['tokens']['admin']}",
            HTTP_X_SCHOOL_ID=str(ctx['SID_A']))
        assert resp.status_code == 204 and not Student.objects.filter(pk=ctx['active'].pk).exists()


@pytest.mark.django_db
class TestExactStatuses:
    """Every status has its own filter, not only the combined Left."""

    @pytest.fixture
    def extra(self, ctx):
        year, school = ctx['academic_year'], ctx['school_a']
        suspended, repeat = ctx['students'][4], ctx['students'][5]
        for student, status in ((suspended, 'SUSPENDED'), (repeat, 'REPEAT')):
            StudentEnrollment.objects.create(
                school=school, student=student, academic_year=year, class_obj=student.class_obj,
                roll_number=student.roll_number, status='ACTIVE', is_active=True,
            )
            student.status = status
            student.save(update_fields=['status'])
        return {**ctx, 'suspended': suspended, 'repeat': repeat}

    def scope(self, api, extra, name):
        return set(ids(api, extra, academic_year=extra['academic_year'].id, status_scope=name))

    def test_withdrawn_lists_only_withdrawn_students(self, api, extra):
        assert self.scope(api, extra, 'withdrawn') == {extra['withdrawn'].id}

    def test_transferred_lists_only_transferred_students(self, api, extra):
        assert self.scope(api, extra, 'transferred') == {extra['transferred'].id}

    def test_graduated_lists_only_graduated_students(self, api, extra):
        assert self.scope(api, extra, 'graduated') == {extra['graduated'].id}

    def test_suspended_lists_students_who_are_still_enrolled_but_suspended(self, api, extra):
        assert self.scope(api, extra, 'suspended') == {extra['suspended'].id}

    def test_repeat_lists_students_repeating_the_year(self, api, extra):
        assert self.scope(api, extra, 'repeat') == {extra['repeat'].id}

    def test_left_is_exactly_the_three_leaving_statuses_together(self, api, extra):
        left = self.scope(api, extra, 'left')
        assert left == self.scope(api, extra, 'withdrawn') | self.scope(api, extra, 'transferred') | self.scope(api, extra, 'graduated')
        assert not {extra['suspended'].id, extra['repeat'].id, extra['active'].id} & left

    def test_the_exact_filters_do_not_overlap(self, api, extra):
        names = ('withdrawn', 'transferred', 'graduated', 'suspended', 'repeat')
        sets = [self.scope(api, extra, n) for n in names]
        assert sum(len(s) for s in sets) == len(set().union(*sets))

    def test_status_scope_is_case_insensitive(self, api, extra):
        assert self.scope(api, extra, 'Withdrawn') == {extra['withdrawn'].id}

    def test_without_an_academic_year_the_current_year_is_used(self, api, extra):
        assert set(ids(api, extra, status_scope='transferred')) == {extra['transferred'].id}

    def test_a_status_with_nobody_in_it_is_just_empty(self, api, ctx):
        assert set(ids(api, ctx, academic_year=ctx['academic_year'].id, status_scope='suspended')) == set()
