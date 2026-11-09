"""Class vs section in Aura's lookups (item A of the backlog): a class with two sections, an orphan section,
and names that are prefixes of each other. Uses the shared seed_data school, no extra schools."""
import pytest

from assistant import registry
from assistant.skills import directory
from assistant.skills import lms_common as lc

pytestmark = pytest.mark.django_db


def _ctx(seed):
    user = seed['users']['admin']
    return registry.ToolContext(user=user, school_id=user.school_id, role=user.role, conversation=None)


class TestFindSections:
    def test_class_returns_both_sections_and_5a_one(self, seed_data, seed_sections):
        ctx, master = _ctx(seed_data), seed_sections['master']
        assert {sc.section for sc in lc.find_sections(ctx, master.name)} == {'A', 'B'}
        assert [sc.section for sc in lc.find_sections(ctx, master.name, 'A')] == ['A']

    def test_orphan_section_is_refused_with_a_clear_message(self, seed_data, seed_sections):
        ctx, a = _ctx(seed_data), seed_sections['section_a']
        type(a).objects.filter(pk=a.pk).update(class_obj=None)
        with pytest.raises(registry.ProposalError, match='not linked to a master class'):
            lc.find_sections(ctx, seed_sections['master'].name)


class TestFindStudentAndClass:
    def test_find_student_uses_this_years_section(self, seed_data, seed_sections):
        ctx, st = _ctx(seed_data), seed_sections['b_students'][0]
        out = directory.find_student(ctx, st.name)
        label = next(m['class'] for m in out['matches'] if m['student_id'] == st.id)
        assert label.endswith(' B')
        only_a = directory.find_student(ctx, st.name, class_name=f"{seed_sections['master'].name} A")
        assert st.id not in {m['student_id'] for m in only_a['matches']}

    def test_find_class_lists_sections_with_master_id(self, seed_data, seed_sections):
        out = directory.find_class(_ctx(seed_data), seed_sections['master'].name)
        sections = [m for m in out['matches'] if m['section_id']]
        assert {m['section'] for m in sections} == {'A', 'B'}
        assert {m['class_id'] for m in sections} == {seed_sections['master'].id}


    def test_an_exact_section_is_not_buried_in_spelling_guesses(self, seed_data, seed_sections):
        out = directory.find_class(_ctx(seed_data), f"{seed_sections['master'].name} B")
        assert [m['section'] for m in out['matches'] if m['section_id']] == ['B']


class TestMasterClassMatching:
    def test_class_1_is_not_class_10(self, seed_data):
        from students.models import Class
        school = seed_data['school_a']
        one = Class.objects.create(school=school, name='Class 1', grade_level=1)
        Class.objects.create(school=school, name='Class 10', grade_level=10)
        assert [c.id for c in directory.master_classes_matching(school.id, 'Class 1')] == [one.id]

    def test_section_name_maps_to_its_master_class(self, seed_data, seed_sections):
        master = seed_sections['master']
        hits = directory.master_classes_matching(seed_data['school_a'].id, f'{master.name} A')
        assert [c.id for c in hits] == [master.id]


class TestFeeClassFilter:
    def test_section_filter_excludes_the_other_section(self, seed_data, seed_sections):
        from django.db.models import Q
        from finance.ai_agent import _payment_class_q
        from finance.models import FeePayment
        school, year = seed_data['school_a'], seed_data['academic_year']
        a_student, b_student = seed_sections['a_students'][0], seed_sections['b_students'][0]
        for st in (a_student, b_student):
            FeePayment.objects.create(school=school, student=st, academic_year=year, month=1, year=2026,
                                      amount_due=100, status='UNPAID')
        master = seed_sections['master']
        whole = set(FeePayment.objects.filter(_payment_class_q(master.name, school.id)).values_list('student_id', flat=True))
        # The seed master class is itself labelled "... A", so section B is the unambiguous one to ask for.
        only_b = set(FeePayment.objects.filter(_payment_class_q(f'{master.name} B', school.id)).values_list('student_id', flat=True))
        assert {a_student.id, b_student.id} <= whole
        assert b_student.id in only_b and a_student.id not in only_b
