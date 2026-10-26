"""
Deleting a grade only deactivates it, and (school, grade_label) is unique, so
re-adding the same label used to answer 400 "already exists" for a grade the
admin could no longer see. Builds on the shared seed_data fixture.
"""
import pytest

from examinations.models import GradeScale

pytestmark = pytest.mark.django_db

URL = '/api/examinations/grade-scales/'


def _payload(**over):
    data = {'grade_label': 'A+', 'min_percentage': 90, 'max_percentage': 100, 'gpa_points': 4.5, 'order': 0}
    data.update(over)
    return data


def test_readd_deleted_grade_revives_it(api, seed_data):
    token, sid = seed_data['tokens']['admin'], seed_data['school_a'].id
    created = api.post(URL, _payload(), token, sid)
    assert created.status_code == 201
    gid = GradeScale.objects.get(school_id=sid, grade_label='A+').pk

    assert api.delete(f'{URL}{gid}/', token, sid).status_code == 204
    assert not GradeScale.objects.get(pk=gid).is_active

    again = api.post(URL, _payload(min_percentage=85, gpa_points=4.0), token, sid)
    assert again.status_code == 201, again.content
    row = GradeScale.objects.get(pk=gid)
    assert row.is_active and float(row.min_percentage) == 85
    assert GradeScale.objects.filter(school_id=sid, grade_label='A+').count() == 1


def test_duplicate_active_label_still_rejected(api, seed_data):
    token, sid = seed_data['tokens']['admin'], seed_data['school_a'].id
    assert api.post(URL, _payload(), token, sid).status_code == 201
    assert api.post(URL, _payload(), token, sid).status_code == 400
