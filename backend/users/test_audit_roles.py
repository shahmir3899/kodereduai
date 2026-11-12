import pytest
from django.core.management import call_command

pytestmark = pytest.mark.django_db


def test_audit_runs_and_writes_nothing(seed_data, capsys):
    from schools.models import UserSchoolMembership
    before = list(UserSchoolMembership.objects.values_list('id', 'role', 'can_manage_finance'))
    call_command('audit_roles')
    out = capsys.readouterr().out
    assert 'Still ACCOUNTANT: users=0, memberships=0' in out
    assert list(UserSchoolMembership.objects.values_list('id', 'role', 'can_manage_finance')) == before
