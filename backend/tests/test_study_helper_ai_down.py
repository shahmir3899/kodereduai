"""When the AI call fails the student gets an error, not an apology dressed up as an answer."""
from unittest.mock import patch

import pytest

from tests.test_phase10_study_helper import URL, student_env  # noqa: F401


@pytest.mark.django_db
def test_ai_failure_is_a_503_and_saves_nothing(seed_data, api, student_env):
    with patch('groq.Groq', side_effect=RuntimeError('groq down')):
        resp = api.post(URL, {'message': 'What is photosynthesis?'}, student_env['token'], student_env['SID_A'])
    assert resp.status_code == 503
    assert 'unavailable' in resp.json()['error']
    history = api.get(URL, student_env['token'], student_env['SID_A'])
    assert history.json() == []
