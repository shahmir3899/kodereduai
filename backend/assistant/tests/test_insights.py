"""Learning loop, step 2: the insights endpoints (scoping, counts, examples, owner-only PATCH)."""
import json
from datetime import timedelta

import pytest
from django.utils import timezone

from assistant.models import AgentGap, AgentGapGroup

pytestmark = pytest.mark.django_db

URL = '/api/assistant/insights/'


def _gap(seed, school='SID_A', kind='missing_tool', summary='list scholarship holders', role='SCHOOL_ADMIN',
         days_ago=1, group=None, agent='students', language='en', user='admin'):
    row = AgentGap.objects.create(
        school_id=seed[school], user=seed['users'].get(user), role=role, agent=agent, kind=kind, language=language,
        summary=summary, group=group, delete_after=timezone.now() + timedelta(days=90),
    )
    AgentGap.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
    return row


def _get(api, seed, uname='admin', sid=None, query=''):
    return api.client.get(URL + query, HTTP_AUTHORIZATION=f'Bearer {seed["tokens"][uname]}',
                          HTTP_X_SCHOOL_ID=str(sid or seed['SID_A']))


@pytest.fixture
def super_token(seed_data, api):
    from users.models import User

    User.objects.create_user(username='PYTEST_super', email='super@test.com', password='TestPass123!',
                             role='SUPER_ADMIN', organization=seed_data['org'])
    return api.login('PYTEST_super')


def _super(api, seed, token, method='get', path=URL, body=None):
    kw = {'HTTP_AUTHORIZATION': f'Bearer {token}', 'HTTP_X_SCHOOL_ID': str(seed['SID_A'])}
    if method == 'get':
        return api.client.get(path, **kw)
    return getattr(api.client, method)(path, data=json.dumps(body), content_type='application/json', **kw)


class TestScoping:
    def test_school_admin_sees_only_their_own_school(self, seed_data, api):
        _gap(seed_data, summary='mine')
        _gap(seed_data, school='SID_B', summary='other school', user='admin_b')
        r = _get(api, seed_data)
        assert r.status_code == 200
        body = r.json()
        assert body['groups'][0]['total'] == 1 and body['groups'][0]['examples'] == ['mine']
        assert 'other school' not in json.dumps(body) and 'schools' not in body

    def test_principal_may_read_but_other_roles_may_not(self, seed_data, api):
        assert _get(api, seed_data, 'principal').status_code == 200
        for uname in ('teacher', 'accountant', 'manager', 'staff'):
            assert _get(api, seed_data, uname).status_code == 403, uname

    def test_school_admin_cannot_widen_scope_with_the_school_parameter(self, seed_data, api):
        _gap(seed_data, school='SID_B', summary='other school', user='admin_b')
        r = _get(api, seed_data, query=f'?school={seed_data["SID_B"]}')
        assert r.json()['groups'] == []

    def test_super_admin_sees_all_schools_and_can_filter(self, seed_data, api, super_token):
        _gap(seed_data, summary='a')
        _gap(seed_data, school='SID_B', summary='b', user='admin_b')
        body = _super(api, seed_data, super_token).json()
        assert body['groups'][0]['total'] == 2 and len(body['groups'][0]['schools']) == 2 and len(body['schools']) == 2
        only_b = _super(api, seed_data, super_token, path=f'{URL}?school={seed_data["SID_B"]}').json()
        assert only_b['groups'][0]['total'] == 1


class TestContent:
    def test_counts_by_window_and_ungrouped_bucket(self, seed_data, api):
        _gap(seed_data, days_ago=2)
        _gap(seed_data, days_ago=10, summary='older')
        body = _get(api, seed_data, query='?days=90').json()
        row = body['groups'][0]
        assert row['label'] == 'Ungrouped' and row['id'] is None
        assert (row['last_7_days'], row['last_30_days'], row['total']) == (1, 2, 2)
        assert len(row['trend']) == 30 and sum(p['count'] for p in row['trend']) == 2

    def test_groups_are_listed_with_status_and_examples_capped_at_three(self, seed_data, api):
        group = AgentGapGroup.objects.create(label='Scholarship list', status='planned', note='soon')
        for i in range(5):
            _gap(seed_data, summary=f'question {i}', group=group)
        row = _get(api, seed_data).json()['groups'][0]
        assert (row['label'], row['status'], row['note']) == ('Scholarship list', 'planned', 'soon')
        assert len(row['examples']) == 3 and row['total'] == 5

    def test_students_and_parents_count_but_give_no_examples(self, seed_data, api):
        _gap(seed_data, summary='', role='PARENT')
        _gap(seed_data, summary='', role='STUDENT')
        row = _get(api, seed_data).json()['groups'][0]
        assert row['total'] == 2 and row['examples'] == []
        assert {r['key'] for r in row['roles']} == {'PARENT', 'STUDENT'}

    def test_thumbs_up_is_a_satisfaction_count_not_a_gap(self, seed_data, api):
        _gap(seed_data, kind='thumbs_up', summary='')
        _gap(seed_data, kind='thumbs_down', summary='x')
        body = _get(api, seed_data).json()
        assert body['satisfaction'] == {'up': 1, 'down': 1}
        assert body['groups'][0]['total'] == 1

    def test_filters(self, seed_data, api):
        _gap(seed_data, kind='denied', agent='finance', summary='')
        _gap(seed_data, kind='missing_tool', agent='hr')
        assert _get(api, seed_data, query='?kind=denied').json()['groups'][0]['total'] == 1
        assert _get(api, seed_data, query='?agent=hr').json()['groups'][0]['total'] == 1
        assert _get(api, seed_data, query='?status=planned').json()['groups'] == []

    def test_bad_numbers_are_a_400(self, seed_data, api):
        assert _get(api, seed_data, query='?days=abc').status_code == 400


class TestGroupPatch:
    def test_super_admin_can_decide_and_link_a_baseline_question(self, seed_data, api, super_token):
        g = AgentGapGroup.objects.create(label='x')
        r = _super(api, seed_data, super_token, 'patch', f'{URL}groups/{g.pk}/',
                   {'status': 'built', 'note': 'done', 'baseline_question_id': 'q-130'})
        assert r.status_code == 200
        g.refresh_from_db()
        assert (g.status, g.note, g.baseline_question_id) == ('built', 'done', 'q-130')

    def test_invalid_status_is_rejected(self, seed_data, api, super_token):
        g = AgentGapGroup.objects.create(label='x')
        assert _super(api, seed_data, super_token, 'patch', f'{URL}groups/{g.pk}/', {'status': 'nope'}).status_code == 400

    @pytest.mark.parametrize('uname', ['admin', 'principal'])
    def test_school_admins_cannot_change_a_group(self, seed_data, api, uname):
        g = AgentGapGroup.objects.create(label='x')
        r = api.client.patch(f'{URL}groups/{g.pk}/', data=json.dumps({'status': 'built'}), content_type='application/json',
                             HTTP_AUTHORIZATION=f'Bearer {seed_data["tokens"][uname]}', HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert r.status_code == 403
        g.refresh_from_db()
        assert g.status == 'new'
