"""The read tools added for the coverage matrix (backlog item F): each goes through the app's own view as the signed-in user."""
from datetime import date

import pytest

from assistant import registry
from assistant.models import AgentConversation
from assistant.skills import load_all

pytestmark = pytest.mark.django_db

NEW = ['get_academic_years', 'get_report_card', 'list_parent_leave_requests', 'list_student_documents', 'list_departments', 'list_vendors']


@pytest.fixture(autouse=True)
def _tools():
    load_all()


@pytest.fixture
def modules(seed_data):
    school, org = seed_data['school_a'], seed_data['org']
    mods = {m: True for m in ('students', 'examinations', 'hr', 'inventory', 'academics', 'finance')}
    school.enabled_modules = {**(school.enabled_modules or {}), **mods}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), **mods}
    org.save(update_fields=['allowed_modules'])


def _run(seed_data, tool, role_key='admin', **args):
    user = seed_data['users'][role_key]
    ctx = registry.ToolContext(user=user, school_id=user.school_id, role=user.role)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
    return registry.execute(ctx, tool, args)


def test_all_six_are_registered_as_reads():
    for name in NEW:
        tool = registry.get_tool(name)
        assert tool is not None and tool.kind == 'read', name


def test_academic_years_lists_the_current_year_and_terms(seed_data, modules):
    out = _run(seed_data, 'get_academic_years')['data']
    assert out['count'] == 1 and out['years'][0]['current'] is True
    assert {t['name'] for t in out['terms']} >= {'PYTEST_Term 1', 'PYTEST_Term 2'}


def test_departments_with_designations(seed_data, modules):
    out = _run(seed_data, 'list_departments')['data']
    assert {d['name'] for d in out['departments']} >= {'PYTEST_Academic', 'PYTEST_Admin'}
    assert {d['name'] for d in out['designations']} >= {'PYTEST_Teacher', 'PYTEST_Clerk'}


def test_vendors_with_a_word_search(seed_data, modules):
    from inventory.models import Vendor
    school = seed_data['school_a']
    Vendor.objects.create(school=school, name='Ahmed Stationers', phone='0300')
    Vendor.objects.create(school=school, name='Zia Books')
    assert _run(seed_data, 'list_vendors')['data']['count'] == 2
    only = _run(seed_data, 'list_vendors', search='Ahmed')['data']
    assert [v['name'] for v in only['vendors']] == ['Ahmed Stationers']


def test_parent_leave_requests_filter_by_status(seed_data, modules):
    from parents.models import ParentChild, ParentProfile
    from parents.models import ParentLeaveRequest
    from users.models import User
    school, org, student = seed_data['school_a'], seed_data['org'], seed_data['students'][0]
    pu = User.objects.create_user(username='cov_parent', email='cov_parent@test.com', password='x', role='PARENT', school=school, organization=org)
    parent = ParentProfile.objects.create(user=pu, phone='0300')
    ParentChild.objects.create(parent=parent, student=student, school=school, relation='FATHER')
    for status in ('PENDING', 'APPROVED'):
        ParentLeaveRequest.objects.create(school=school, parent=parent, student=student, start_date=date(2026, 1, 5), end_date=date(2026, 1, 6),
                                          reason='wedding', status=status)
    assert _run(seed_data, 'list_parent_leave_requests')['data']['count'] == 2
    pending = _run(seed_data, 'list_parent_leave_requests', status='PENDING')['data']
    assert pending['count'] == 1 and pending['requests'][0]['status'] == 'PENDING'


def test_student_documents_hide_the_file_link(seed_data, modules):
    from students.models import StudentDocument
    student = seed_data['students'][0]
    doc_type = StudentDocument._meta.get_field('document_type').choices[0][0]
    StudentDocument.objects.create(school=seed_data['school_a'], student=student, document_type=doc_type, title='Birth certificate',
                                   file_url='https://example.com/secret-file.pdf')
    out = _run(seed_data, 'list_student_documents', student_id=student.id)
    assert out['data']['documents'][0]['title'] == 'Birth certificate'
    assert 'secret-file' not in repr(out)


def test_report_card_with_no_exam_says_so_instead_of_failing(seed_data, modules):
    out = _run(seed_data, 'get_report_card', student_id=seed_data['students'][0].id)
    assert 'data' in out or 'error' in out            # either the card or a plain sentence, never a crash
    assert 'failed' not in str(out.get('error', ''))


def test_report_card_unknown_exam_name_is_a_clear_error(seed_data, modules):
    out = _run(seed_data, 'get_report_card', student_id=seed_data['students'][0].id, exam_name='Nonexistent Exam')
    assert 'No exam matching' in out['error']


def test_roles_are_enforced(seed_data, modules):
    # a teacher may not read parents' leave requests, student documents or vendors
    for tool in ('list_parent_leave_requests', 'list_student_documents', 'list_vendors'):
        assert _run(seed_data, tool, 'teacher') == {'error': 'You do not have permission to use this tool.'}, tool
    # an accountant has none of the six
    for tool in NEW:
        assert _run(seed_data, tool, 'accountant') == {'error': 'You do not have permission to use this tool.'}, tool
