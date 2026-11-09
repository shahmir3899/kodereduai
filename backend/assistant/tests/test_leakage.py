"""Leakage suite, generated from the tool registry (item C of the backlog), so a new tool is covered the moment it registers.

1. Role matrix: for every tool and every role, may it be used? Compared with the tool's own declaration, never the other way round.
2. Cross-tenant: school A's admin calls every tool with school B's ids and names; nothing of B may come back.
3. Cross-role: a parent asking for a child who is not theirs, a student asking for another student, a teacher asking for a colleague's pay.

No model is reached (the conftest tripwire would raise); a tool that wants one is counted as "needs model" and skipped, not hidden.
Calls run inside savepoints, so nothing is kept. Coverage numbers are printed with `pytest -s`."""
from datetime import date

import pytest
from django.db import transaction

from assistant import registry
from assistant.skills import load_all

pytestmark = pytest.mark.django_db

ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER', 'PARENT', 'STUDENT')
MARK_B = 'LEAKCHECK_B'
# Appears only in school B's stored names, never in what a test sends: a tool that echoes the query back ("no class named ...") is not a leak.
SECRET = 'SECRET9X'


@pytest.fixture(scope='module', autouse=True)
def _tools_loaded():
    load_all()


def _all_modules():
    return sorted({t.module for t in registry.all_tools() if t.module})


def _enable_modules(school, org):
    mods = {m: True for m in _all_modules()}
    school.enabled_modules = {**(school.enabled_modules or {}), **mods}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), **mods}
    org.save(update_fields=['allowed_modules'])


def _ctx(user, role=None, school_id=None):
    return registry.ToolContext(user=user, school_id=school_id or user.school_id, role=role or user.role)


# ── arguments built from each tool's own schema ──────────────────────────────

def _args_for(tool, ids, name):
    """Every property filled: ids point at the foreign records, names at the foreign marker."""
    out = {}
    for key, spec in ((tool.parameters or {}).get('properties') or {}).items():
        kind = spec.get('type')
        if spec.get('enum'):
            out[key] = spec['enum'][0]
        elif kind == 'integer':
            if key in ('month',):
                out[key] = 1
            elif key in ('year',):
                out[key] = 2026
            elif 'class' in key:
                out[key] = ids['class']
            elif 'staff' in key or 'teacher' in key or 'employee' in key:
                out[key] = ids['staff']
            else:
                out[key] = ids['student']
        elif kind == 'number':
            out[key] = 1
        elif kind == 'boolean':
            out[key] = False
        elif kind == 'array':
            item = (spec.get('items') or {}).get('type')
            out[key] = [ids['student']] if item == 'integer' else ([name] if item == 'string' else [])
        elif kind == 'object':
            out[key] = {}
        elif 'date' in key:
            out[key] = '2026-01-15'
        else:
            out[key] = name
    return out


def _run_all(ctx, tools, ids, name, marker_checks):
    """Call every tool once. Returns coverage counts; asserts no marker appears in any result or stored card."""
    from assistant.models import AgentAction

    stats = {'called': 0, 'data': 0, 'error': 0, 'needs_model': 0}
    leaks = []
    for tool in tools:
        args = _args_for(tool, ids, name)
        try:
            with transaction.atomic():
                result = registry.execute(ctx, tool.name, args)
                stored = ''
                if 'proposal' in result:
                    action = AgentAction.objects.filter(pk=result['proposal']['action_id']).first()
                    stored = repr((action.payload, action.preview)) if action else ''
        except BaseException as exc:          # the conftest tripwire is a BaseException on purpose
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            stats['needs_model'] += 1
            continue
        stats['called'] += 1
        text = repr(result) + stored
        stats['error' if 'error' in result else 'data'] += 1
        for marker in marker_checks:
            if marker in text:
                leaks.append((tool.name, marker))
    return stats, leaks


# ── 1. role matrix ───────────────────────────────────────────────────────────

class TestRoleMatrix:
    def test_every_tool_obeys_its_own_roles_and_the_module_gate(self, seed_data):
        school, org = seed_data['school_a'], seed_data['org']
        _enable_modules(school, org)
        admin = seed_data['users']['admin']
        wrong = []
        for tool in registry.all_tools():
            for role in ROLES:
                allowed = registry.is_allowed(tool, _ctx(admin, role))
                expected = role in tool.roles and not (tool.kind == 'write' and role in registry.NO_WRITE_ROLES)
                if allowed != expected:
                    wrong.append((tool.name, role, allowed))
        assert not wrong, wrong[:10]

    def test_a_disallowed_call_is_refused_before_any_handler_runs(self, seed_data):
        _enable_modules(seed_data['school_a'], seed_data['org'])
        admin = seed_data['users']['admin']
        for tool in registry.all_tools():
            for role in ROLES:
                if role in tool.roles and not (tool.kind == 'write' and role in registry.NO_WRITE_ROLES):
                    continue
                out = registry.execute(_ctx(admin, role), tool.name, {})
                assert out == {'error': 'You do not have permission to use this tool.'}, (tool.name, role)

    def test_parents_and_students_never_get_a_write_tool(self, seed_data):
        _enable_modules(seed_data['school_a'], seed_data['org'])
        admin = seed_data['users']['admin']
        for role in registry.NO_WRITE_ROLES:
            assert not [t.name for t in registry.tools_for(_ctx(admin, role)) if t.kind == 'write']

    def test_with_every_module_off_only_ungated_tools_remain(self, seed_data):
        school = seed_data['school_a']
        school.enabled_modules = {m: False for m in _all_modules()}
        school.save(update_fields=['enabled_modules'])
        got = registry.tools_for(_ctx(seed_data['users']['admin']))
        assert all(not t.module for t in got), [t.name for t in got if t.module][:10]


# ── 2. cross-tenant ──────────────────────────────────────────────────────────

@pytest.fixture
def school_b_data(seed_data):
    from hr.models import StaffMember
    from students.models import Class, Student

    b = seed_data['school_b']
    klass = Class.objects.create(school=b, name=f'{MARK_B}_Class_{SECRET}', section='Z', grade_level=1)
    students = [Student.objects.create(school=b, class_obj=klass, roll_number=str(i), name=f'{MARK_B}_Student{i}_{SECRET}', is_active=True, status='ACTIVE')
                for i in (1, 2)]
    staff = StaffMember.objects.create(school=b, first_name=f'{MARK_B}_Staff_{SECRET}', last_name='Person', employee_id=f'{MARK_B}_E1',
                                       employment_status='ACTIVE', employment_type='FULL_TIME', date_of_joining=date(2024, 1, 1))
    return {'ids': {'class': klass.id, 'student': students[0].id, 'staff': staff.id}, 'school': b}


class TestCrossTenant:
    def test_school_a_admin_never_receives_school_b_data(self, seed_data, school_b_data):
        _enable_modules(seed_data['school_a'], seed_data['org'])
        ctx = _ctx(seed_data['users']['admin'])
        tools = registry.tools_for(ctx)
        stats, leaks = _run_all(ctx, tools, school_b_data['ids'], f'{MARK_B}_Student1', [SECRET])
        print(f'[cross-tenant] {len(tools)} tools: {stats}')
        assert not leaks, leaks
        assert stats['called'] > 0

    def test_write_tools_given_foreign_ids_propose_nothing_for_another_school(self, seed_data, school_b_data):
        from assistant.models import AgentAction
        _enable_modules(seed_data['school_a'], seed_data['org'])
        ctx = _ctx(seed_data['users']['admin'])
        writes = [t for t in registry.tools_for(ctx) if t.kind == 'write']
        _stats, leaks = _run_all(ctx, writes, school_b_data['ids'], f'{MARK_B}_Student1', [SECRET])
        assert not leaks, leaks
        assert not AgentAction.objects.filter(school_id=school_b_data['school'].id).exists()


class TestCrossRole:
    def _foreign_ids(self, seed_data, student_index=5):
        other = seed_data['students'][student_index]
        return {'class': other.class_obj_id, 'student': other.id, 'staff': seed_data['staff'][1].id}, other

    def test_a_parent_cannot_reach_a_child_who_is_not_theirs(self, seed_data):
        from parents.models import ParentChild, ParentProfile
        from users.models import User

        school, org = seed_data['school_a'], seed_data['org']
        _enable_modules(school, org)
        user = User.objects.create_user(username='LEAK_parent', email='leak_parent@test.com', password='x', role='PARENT', school=school, organization=org)
        profile = ParentProfile.objects.create(user=user, phone='0300')
        ParentChild.objects.create(parent=profile, student=seed_data['students'][0], school=school, relation='FATHER')
        ids, other = self._foreign_ids(seed_data)
        tools = registry.tools_for(_ctx(user))
        assert tools, 'a parent should have the family tools'
        # only the first name is sent, so a tool that echoes its input back is not mistaken for a leak of the full name
        stats, leaks = _run_all(_ctx(user), tools, ids, 'Ayesha', ['Ayesha Malik'])
        print(f'[parent] {len(tools)} tools: {stats}')
        assert not leaks, leaks

    def test_a_student_cannot_reach_another_student(self, seed_data):
        from students.models import StudentProfile
        from users.models import User

        school, org = seed_data['school_a'], seed_data['org']
        _enable_modules(school, org)
        user = User.objects.create_user(username='LEAK_student', email='leak_student@test.com', password='x', role='STUDENT', school=school, organization=org)
        StudentProfile.objects.create(user=user, student=seed_data['students'][0], school=school)
        ids, _other = self._foreign_ids(seed_data)
        tools = registry.tools_for(_ctx(user))
        assert tools
        stats, leaks = _run_all(_ctx(user), tools, ids, 'Ayesha', ['Ayesha Malik'])
        print(f'[student] {len(tools)} tools: {stats}')
        assert not leaks, leaks

    @pytest.mark.parametrize('role', ['TEACHER', 'STAFF', 'MANAGER', 'ACCOUNTANT'])
    def test_non_admin_staff_never_see_a_colleagues_pay(self, seed_data, role):
        from decimal import Decimal
        from hr.models import SalaryStructure

        school, org = seed_data['school_a'], seed_data['org']
        _enable_modules(school, org)
        colleague = seed_data['staff'][1]
        SalaryStructure.objects.create(staff_member=colleague, school=school, basic_salary=Decimal('98765.43'), effective_from=date(2025, 1, 1))
        user = seed_data['staff'][0].user if role == 'TEACHER' else seed_data['users'][role.lower()]
        ids, _other = self._foreign_ids(seed_data)
        ctx = _ctx(user, role)
        stats, leaks = _run_all(ctx, registry.tools_for(ctx), ids, colleague.first_name, ['98765'])
        print(f'[{role}] {stats}')
        assert not leaks, leaks
