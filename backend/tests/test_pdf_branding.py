"""
The school's logo on generated PDFs, and the rule that a bad logo never breaks a report.

Run:
    cd backend
    pytest tests/test_pdf_branding.py -v
"""
import io
from types import SimpleNamespace

import pytest
from django.core.cache import cache
from PIL import Image

from core import pdf_branding
from core.url_safety import UnsafeUrlError
from reports.generators.base import BaseReportGenerator
from reports.generators.finance import FinanceSummaryReportGenerator
from schools.models import School


def _png(w=40, h=20):
    out = io.BytesIO()
    Image.new('RGB', (w, h), (200, 30, 30)).save(out, format='PNG')
    return out.getvalue()


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def school(db):
    return School.objects.create(name='PYTEST Logo School', subdomain='pytest-pdf', logo='https://cdn.test/logo.png')


@pytest.fixture
def fetch(monkeypatch):
    """Serve `content` for any logo URL and count the calls."""
    state = SimpleNamespace(content=_png(), calls=0, fail=False)

    def fake_get(url, timeout=None):
        state.calls += 1
        if state.fail:
            raise RuntimeError('down')
        return SimpleNamespace(content=state.content, raise_for_status=lambda: None)

    monkeypatch.setattr(pdf_branding.requests, 'get', fake_get)
    monkeypatch.setattr(pdf_branding, 'assert_safe_external_url', lambda url: None)
    return state


@pytest.mark.django_db
class TestLogoLoading:
    def test_a_good_logo_comes_back_as_png_with_its_size(self, school, fetch):
        png, w, h = pdf_branding.school_logo_png(school)
        assert png.startswith(b'\x89PNG')
        assert (w, h) == (40, 20)

    def test_a_big_logo_is_shrunk(self, school, fetch):
        fetch.content = _png(2000, 1000)
        _, w, h = pdf_branding.school_logo_png(school)
        assert max(w, h) == pdf_branding.LOGO_MAX_PX

    def test_no_logo_means_none_and_no_fetch(self, db, fetch):
        bare = School.objects.create(name='Bare', subdomain='bare-pdf')
        assert pdf_branding.school_logo_png(bare) is None
        assert pdf_branding.school_logo_png(None) is None
        assert fetch.calls == 0

    def test_something_that_is_not_an_image_is_ignored(self, school, fetch):
        fetch.content = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        assert pdf_branding.school_logo_png(school) is None

    def test_an_unreachable_url_is_ignored(self, school, fetch):
        fetch.fail = True
        assert pdf_branding.school_logo_png(school) is None

    def test_an_unsafe_url_is_refused_without_fetching(self, school, fetch, monkeypatch):
        def refuse(url):
            raise UnsafeUrlError('internal address')
        monkeypatch.setattr(pdf_branding, 'assert_safe_external_url', refuse)
        assert pdf_branding.school_logo_png(school) is None
        assert fetch.calls == 0

    def test_a_good_logo_is_fetched_once_then_cached(self, school, fetch):
        pdf_branding.school_logo_png(school)
        pdf_branding.school_logo_png(school)
        assert fetch.calls == 1

    def test_a_failure_is_remembered_briefly(self, school, fetch):
        fetch.fail = True
        pdf_branding.school_logo_png(school)
        pdf_branding.school_logo_png(school)
        assert fetch.calls == 1


def _base_pdf(school):
    data = {'title': 'Fee report', 'table_headers': ['A', 'B'], 'table_rows': [['1', '2']]}
    return BaseReportGenerator(school).render_pdf(data)


def _finance_pdf(school):
    data = {
        'title': 'Finance Report', 'subtitle': 'Period: this month',
        'sections': [{'heading': 'Summary', 'headers': ['Item', 'Amount'], 'rows': [['Fees', '100']], 'widths': [0.5, 0.5]}],
    }
    return FinanceSummaryReportGenerator(school).render_pdf(data)


@pytest.mark.django_db
class TestReportsCarryTheLogo:
    def test_the_general_report_has_an_image_with_a_logo_and_none_without(self, school, fetch):
        assert b'/Subtype /Image' in _base_pdf(school)
        cache.clear()
        fetch.fail = True
        assert b'/Subtype /Image' not in _base_pdf(school)

    def test_the_finance_report_has_an_image_with_a_logo_and_none_without(self, school, fetch):
        assert b'/Subtype /Image' in _finance_pdf(school)
        cache.clear()
        fetch.fail = True
        assert b'/Subtype /Image' not in _finance_pdf(school)

    def test_a_broken_logo_never_breaks_the_report(self, school, fetch):
        fetch.content = b'not an image at all'
        assert _base_pdf(school).startswith(b'%PDF')
        assert _finance_pdf(school).startswith(b'%PDF')
