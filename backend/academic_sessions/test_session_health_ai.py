"""The session-health dashboard call must never wait on the Groq AI summary (it cost
1.5-2.3 s on every dashboard load); the AI text is a separate, cached request."""
from unittest.mock import patch

import pytest
from django.core.cache import cache

from academic_sessions.session_health_service import SessionHealthService

AI_RESULT = {'highlights': ['Attendance is steady'], 'concerns': [], 'action_items': [], 'source': 'ai'}


@pytest.fixture(autouse=True)
def clean_cache():
    cache.clear()
    yield
    cache.clear()


def health(api, ctx, path=''):
    return api.get(
        f"/api/sessions/health/{path}?academic_year={ctx['academic_year'].id}",
        ctx['tokens']['admin'], ctx['SID_A'],
    )


@pytest.mark.django_db
class TestHealthEndpointIsFast:
    def test_the_page_call_never_calls_groq(self, api, seed_data, settings):
        settings.GROQ_API_KEY = 'test-key'
        with patch.object(SessionHealthService, '_ai_summary_via_groq',
                          side_effect=AssertionError('Groq must not be called on the page request')) as groq:
            resp = health(api, seed_data)

        assert resp.status_code == 200, resp.content
        groq.assert_not_called()
        body = resp.json()
        assert body['ai_summary']['source'] == 'rule_based'
        assert body['ai_summary_available'] is True

    def test_it_says_no_ai_summary_is_available_without_a_key(self, api, seed_data, settings):
        settings.GROQ_API_KEY = ''

        body = health(api, seed_data).json()

        assert body['ai_summary_available'] is False


@pytest.mark.django_db
class TestAISummaryEndpoint:
    def test_it_returns_the_ai_summary_and_caches_it(self, api, seed_data, settings):
        settings.GROQ_API_KEY = 'test-key'
        with patch.object(SessionHealthService, '_ai_summary_via_groq', return_value=AI_RESULT) as groq:
            first = health(api, seed_data, 'ai-summary/')
            second = health(api, seed_data, 'ai-summary/')

        assert first.status_code == 200 and second.status_code == 200
        assert first.json()['ai_summary']['source'] == 'ai'
        assert second.json() == first.json()
        assert groq.call_count == 1  # the second dashboard load came from the cache

    def test_it_falls_back_to_the_rule_based_summary_when_groq_fails(self, api, seed_data, settings):
        settings.GROQ_API_KEY = 'test-key'
        with patch.object(SessionHealthService, '_ai_summary_via_groq', side_effect=RuntimeError('groq down')):
            resp = health(api, seed_data, 'ai-summary/')

        assert resp.status_code == 200
        assert resp.json()['ai_summary']['source'] == 'rule_based'

    def test_each_school_gets_its_own_cached_summary(self, api, seed_data, settings):
        settings.GROQ_API_KEY = 'test-key'
        with patch.object(SessionHealthService, '_ai_summary_via_groq', return_value=AI_RESULT) as groq:
            health(api, seed_data, 'ai-summary/')
            other = api.get(
                f"/api/sessions/health/ai-summary/?academic_year={seed_data['academic_year'].id}",
                seed_data['tokens']['admin_b'], seed_data['SID_B'],
            )

        # School B has no such academic year, so it must not be served school A's text.
        assert other.status_code in (403, 404)
        assert groq.call_count == 1

    def test_it_requires_a_login(self, api, seed_data):
        resp = api.get_no_auth(f"/api/sessions/health/ai-summary/?academic_year={seed_data['academic_year'].id}")

        assert resp.status_code == 401
