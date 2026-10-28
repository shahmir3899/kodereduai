import pytest
from rest_framework.test import APIClient

from guide_progress import catalog, rules
from guide_progress.models import GuideProgress
from schools.models import Organization, School, UserSchoolMembership
from users.models import User

pytestmark = pytest.mark.django_db

VIDEO = catalog.load()['videos'][0]['id']
OTHER_VIDEO = catalog.load()['videos'][1]['id']
# Every "Start here" step now has a video, so the tick-only path is tested with a made-up step.
TICK_STEP = '99.9'


@pytest.fixture(autouse=True)
def tick_step_known(monkeypatch):
    real = catalog.step_ids
    monkeypatch.setattr(catalog, 'step_ids', lambda: real() | {TICK_STEP})


@pytest.fixture
def world():
    org = Organization.objects.create(name='GP Org', slug='gp-org')
    a = School.objects.create(organization=org, name='GP A', subdomain='gp-a')
    b = School.objects.create(organization=org, name='GP B', subdomain='gp-b')

    def make(name, role, school):
        u = User.objects.create_user(username=name, email=f'{name}@test.com', password='x', role=role, school=school, organization=org)
        UserSchoolMembership.objects.create(user=u, school=school, role=role, is_default=True)
        return u

    return {
        'a': a, 'b': b,
        'admin': make('gp_admin', 'SCHOOL_ADMIN', a),
        'admin_b': make('gp_admin_b', 'SCHOOL_ADMIN', b),
        'teacher': make('gp_teacher', 'TEACHER', a),
        'teacher2': make('gp_teacher2', 'TEACHER', a),
        'parent': make('gp_parent', 'PARENT', a),
        'student': make('gp_student', 'STUDENT', a),
    }


def client(user, school):
    c = APIClient()
    c.force_authenticate(user)
    c.defaults['HTTP_X_SCHOOL_ID'] = str(school.id)
    return c


def post_video(c, ranges, duration=100, vid=VIDEO, **extra):
    return c.post('/api/guide/progress/video/', {'id': vid, 'ranges': ranges, 'duration': duration, **extra}, format='json')


def test_rules_mirror_the_browser_threshold():
    assert rules.COMPLETE_AT == 0.85
    assert not rules.is_complete([[0, 84]], 100)
    assert rules.is_complete([[0, 85]], 100)
    assert rules.merge_ranges([[0, 10], [10.2, 20], [30, 40]]) == [[0, 20], [30, 40]]


def test_completion_comes_from_ranges_not_the_client(world):
    c = client(world['teacher'], world['a'])
    r = post_video(c, [[0, 50]], completed=True, completedAt='2020-01-01')
    assert r.status_code == 200 and r.data['completedAt'] is None
    r = post_video(c, [[50, 90]])
    assert r.data['completedAt'] is not None and r.data['ranges'] == [[0, 90]]


def test_progress_never_goes_backwards(world):
    c = client(world['teacher'], world['a'])
    post_video(c, [[0, 90]])
    r = post_video(c, [[0, 5]], duration=10)
    row = GuideProgress.objects.get(user=world['teacher'], key=VIDEO)
    assert row.completed_at is not None and row.duration == 100 and rules.ranges_total(row.ranges) >= 90


def test_garbage_input_is_ignored(world):
    c = client(world['teacher'], world['a'])
    r = post_video(c, [['x', 1], [5], [-5, 3], [9, 2], None, [1e12, 2e12]], duration=100)
    assert r.status_code == 200
    assert post_video(c, [[0, 1]], vid='nope').status_code == 400


def test_users_see_only_their_own_progress(world):
    post_video(client(world['teacher'], world['a']), [[0, 90]])
    other = client(world['teacher2'], world['a']).get('/api/guide/progress/mine/')
    assert other.data['videos'] == {}
    assert VIDEO in client(world['teacher'], world['a']).get('/api/guide/progress/mine/').data['videos']


def test_payload_cannot_name_another_user(world):
    c = client(world['teacher'], world['a'])
    c.post('/api/guide/progress/video/', {'id': VIDEO, 'ranges': [[0, 90]], 'duration': 100,
                                           'user': world['teacher2'].id, 'user_id': world['teacher2'].id}, format='json')
    assert not GuideProgress.objects.filter(user=world['teacher2']).exists()


@pytest.mark.parametrize('who', ['parent', 'student'])
def test_parents_and_students_can_track_themselves(world, who):
    c = client(world[who], world['a'])
    assert post_video(c, [[0, 90]]).status_code == 200
    assert c.get('/api/guide/progress/mine/').status_code == 200


@pytest.mark.parametrize('who', ['parent', 'student', 'teacher'])
def test_overview_is_admin_only(world, who):
    c = client(world[who], world['a'])
    assert c.get('/api/guide/progress/overview/').status_code == 403
    assert c.get('/api/guide/progress/overview/export/').status_code == 403
    assert c.get(f"/api/guide/progress/user/{world['teacher'].id}/").status_code == 403


def test_step_with_video_cannot_be_ticked(world):
    c = client(world['teacher'], world['a'])
    section = catalog.load()['videos'][0]['section']
    assert c.post('/api/guide/progress/step/', {'id': section, 'done': True}, format='json').status_code == 400
    assert c.post('/api/guide/progress/step/', {'id': TICK_STEP, 'done': True}, format='json').status_code == 200
    assert c.post('/api/guide/progress/step/', {'id': TICK_STEP, 'done': False}, format='json').status_code == 200
    assert not GuideProgress.objects.filter(kind='step').exists()


def test_sync_uploads_local_progress_once_and_caps(world):
    c = client(world['teacher'], world['a'])
    body = {'videos': {VIDEO: {'ranges': [[0, 95]], 'duration': 100, 'position': 95, 'language': 'ur'}, 'zzz': {}},
            'steps': {TICK_STEP: '2026-01-01'}}
    r = c.post('/api/guide/progress/sync/', body, format='json')
    assert r.status_code == 200 and r.data['videos'][VIDEO]['completedAt'] and TICK_STEP in r.data['steps']
    assert 'zzz' not in r.data['videos']
    c.post('/api/guide/progress/sync/', body, format='json')
    assert GuideProgress.objects.filter(user=world['teacher']).count() == 2
    big = {'videos': {f'v{i}': {} for i in range(400)}}
    assert c.post('/api/guide/progress/sync/', big, format='json').status_code == 400


def test_admin_sees_only_own_school(world):
    post_video(client(world['teacher'], world['a']), [[0, 90]])
    r = client(world['admin'], world['a']).get('/api/guide/progress/overview/')
    names = {row['username'] for row in r.data['results']}
    assert 'gp_teacher' in names and 'gp_admin_b' not in names
    row = next(x for x in r.data['results'] if x['username'] == 'gp_teacher')
    assert row['videos_watched'] == 1

    # admin of school B cannot read school A by sending A's id
    c = APIClient()
    c.force_authenticate(world['admin_b'])
    c.defaults['HTTP_X_SCHOOL_ID'] = str(world['a'].id)
    assert c.get('/api/guide/progress/overview/').status_code in (400, 403)
    r = client(world['admin_b'], world['b']).get('/api/guide/progress/overview/')
    assert 'gp_teacher' not in {row['username'] for row in r.data['results']}
    assert client(world['admin_b'], world['b']).get(f"/api/guide/progress/user/{world['teacher'].id}/").status_code == 404


def test_overview_filters_and_status(world):
    post_video(client(world['teacher'], world['a']), [[0, 90]])
    c = client(world['admin'], world['a'])
    got = lambda **q: {r['username'] for r in c.get('/api/guide/progress/overview/', q).data['results']}
    assert got(search='teacher2') == {'gp_teacher2'}
    assert got(role='PARENT') == {'gp_parent'}
    assert 'gp_teacher' not in got(status='not_started') and 'gp_teacher2' in got(status='not_started')
    assert 'gp_teacher' in got(status='in_progress')
    summary = c.get('/api/guide/progress/overview/').data['summary']
    assert summary['tracked'] == 5 and summary['in_progress'] == 1


def test_export_neutralises_formulas(world):
    User.objects.filter(pk=world['parent'].pk).update(first_name='=HYPERLINK("x")')
    r = client(world['admin'], world['a']).get('/api/guide/progress/overview/export/')
    body = r.content.decode()
    assert r.status_code == 200 and "'=HYPERLINK" in body and ',=HYPERLINK' not in body


def test_detail_lists_steps(world):
    post_video(client(world['teacher'], world['a']), [[0, 90]])
    r = client(world['admin'], world['a']).get(f"/api/guide/progress/user/{world['teacher'].id}/")
    assert r.status_code == 200 and r.data['steps']


def test_last_seen_is_the_later_of_login_and_guide_use(world):
    from datetime import timedelta
    from django.utils import timezone
    login = timezone.now() - timedelta(days=3)
    User.objects.filter(pk=world['teacher'].pk).update(last_login=login)
    c = client(world['admin'], world['a'])
    row = next(r for r in c.get('/api/guide/progress/overview/').data['results'] if r['username'] == 'gp_teacher')
    assert row['last_activity'] is None and abs((row['last_seen'] - login).total_seconds()) < 1
    post_video(client(world['teacher'], world['a']), [[0, 10]])
    row = next(r for r in c.get('/api/guide/progress/overview/').data['results'] if r['username'] == 'gp_teacher')
    assert row['last_seen'] > login


def test_videos_total_is_role_based_and_follows_the_catalog(world):
    post_video(client(world['teacher'], world['a']), [[0, 90]])
    c = client(world['admin'], world['a'])
    rows = {r['username']: r for r in c.get('/api/guide/progress/overview/').data['results']}
    expected = len(catalog.videos_for_role('TEACHER', world['a'].enabled_modules or {}))
    assert rows['gp_teacher']['videos_total'] == expected > 0
    assert rows['gp_parent']['videos_total'] == len(catalog.videos_for_role('PARENT', world['a'].enabled_modules or {}))
    assert rows['gp_teacher']['videos_watched'] <= rows['gp_teacher']['videos_total']
    assert rows['gp_teacher']['videos_percent'] == round(rows['gp_teacher']['videos_watched'] / expected * 100)


def test_a_video_with_no_roles_is_for_everyone():
    everyone = [v['id'] for v in catalog.load()['videos'] if not v.get('roles') and not v.get('module')]
    assert everyone
    for role in ('TEACHER', 'PRINCIPAL', 'PARENT', 'STUDENT'):
        assert set(everyone) <= catalog.videos_for_role(role, {})


def test_module_switch_matches_the_frontend():
    assert catalog.module_enabled({'finance': True}, 'finance')
    assert catalog.module_enabled({'finance': {'enabled': True}}, 'finance')
    assert not catalog.module_enabled({'finance': {'enabled': False}}, 'finance')
    assert not catalog.module_enabled({}, 'finance')       # never listed means off, as isModuleEnabled
    assert catalog.module_enabled({}, None)


def test_own_counts_equal_the_admin_overview(world):
    everyone = next(v['id'] for v in catalog.load()['videos'] if not v.get('roles') and not v.get('module'))
    t = client(world['teacher'], world['a'])
    post_video(t, [[0, 90]], vid=everyone)
    mine = t.get('/api/guide/progress/mine/').data['counts']
    row = next(r for r in client(world['admin'], world['a']).get('/api/guide/progress/overview/').data['results']
               if r['username'] == 'gp_teacher')
    assert mine == {k: row[k] for k in ('steps_done', 'steps_total', 'videos_watched', 'videos_total')}
    assert mine['videos_watched'] == 1
    # every save answers with the fresh numbers too
    assert post_video(t, [[0, 90]], vid=everyone).data['counts'] == mine


def test_every_start_step_and_video_section_lines_up():
    # One recording may serve two guide sections, but each catalog video belongs to exactly one section
    # and each section has at most one video, so progress can never be counted twice for one recording.
    videos = catalog.load()['videos']
    assert len({v['id'] for v in videos}) == len(videos)
    assert len({v['section'] for v in videos}) == len(videos)


def test_old_duplicate_video_progress_is_merged(world):
    import importlib
    from django.apps import apps
    from django.utils import timezone
    mig = importlib.import_module('guide_progress.migrations.0002_merge_duplicate_video_progress')
    now = timezone.now()
    user, school = world['teacher'], world['a']
    new_key, old_key = 'ch2-step-4-add-subjects', 'ch5-managing-subjects'
    GuideProgress.objects.create(school=school, user=user, kind='video', key=old_key, seconds_played=40,
                                 duration=47, completed_at=now, last_activity=now)
    mig.merge_progress(apps, None)
    rows = GuideProgress.objects.filter(user=user, kind='video')
    assert [r.key for r in rows] == [new_key] and rows[0].completed_at
    # watched under both ids: one row survives and keeps the completion
    GuideProgress.objects.create(school=school, user=user, kind='video', key=old_key, seconds_played=10,
                                 duration=47, last_activity=now)
    mig.merge_progress(apps, None)
    rows = GuideProgress.objects.filter(user=user, kind='video')
    assert rows.count() == 1 and rows[0].completed_at and rows[0].seconds_played == 40
