"""
Admin-dashboard bootstrap: opt-in module sections (transport, library, hostel,
inventory, admissions). They fold five dashboard requests into the bootstrap call.

Run:
    cd backend
    pytest tests/test_bootstrap_module_sections.py -v
"""
import pytest

URL = '/api/bootstrap/admin-dashboard/'
ALL = 'transport,library,hostel,inventory,admissions'


def _get(api, seed_data, who='admin', school='SID_A', sections=ALL):
    return api.get(f'{URL}?sections={sections}', seed_data['tokens'][who], seed_data[school])


def _enable(school, **mods):
    for k, v in mods.items():
        school.enabled_modules[k] = v
    school.save(update_fields=['enabled_modules'])


@pytest.mark.django_db
class TestBootstrapModuleSections:
    def test_default_sections_unchanged(self, seed_data, api):
        """Existing callers (no ?sections=) must not suddenly receive module sections."""
        resp = api.get(URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        body = resp.json()
        for key in ('transport', 'library', 'hostel', 'inventory', 'admissions_new_count'):
            assert key not in body

    def test_enabled_modules_return_same_payload_as_their_endpoints(self, seed_data, api):
        _enable(seed_data['school_a'], transport=True, library=True, hostel=True, inventory=True, admissions=True)
        tok, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        body = _get(api, seed_data).json()

        assert body['transport'] == api.get('/api/transport/dashboard/', tok, sid).json()
        assert body['library'] == api.get('/api/library/stats/', tok, sid).json()
        assert body['hostel'] == api.get('/api/hostel/dashboard/', tok, sid).json()
        assert body['inventory'] == api.get('/api/inventory/dashboard/', tok, sid).json()
        enquiries = api.get('/api/admissions/enquiries/?status=NEW&page_size=1', tok, sid).json()
        assert body['admissions_new_count'] == enquiries['count']

    def test_disabled_module_is_omitted(self, seed_data, api):
        _enable(seed_data['school_a'], transport=True, library=False, hostel=False, inventory=False, admissions=False)
        body = _get(api, seed_data).json()
        assert 'transport' in body
        for key in ('library', 'hostel', 'inventory', 'admissions_new_count'):
            assert key not in body

    def test_manager_gets_no_module_sections(self, seed_data, api):
        """Inventory denies MANAGER, and the dashboard tiles are admin-only."""
        _enable(seed_data['school_a'], transport=True, library=True, hostel=True, inventory=True, admissions=True)
        resp = _get(api, seed_data, who='manager')
        assert resp.status_code == 200
        body = resp.json()
        for key in ('transport', 'library', 'hostel', 'inventory', 'admissions_new_count'):
            assert key not in body

    def test_teacher_is_forbidden(self, seed_data, api):
        assert _get(api, seed_data, who='teacher').status_code == 403

    def test_a_failing_builder_returns_null_not_a_500(self, seed_data, api, monkeypatch):
        """The client falls back to that module's own endpoint when a section is null."""
        _enable(seed_data['school_a'], transport=True, library=True)

        def boom(school_id):
            raise RuntimeError('boom')

        import library.views
        monkeypatch.setattr(library.views, 'build_stats_summary', boom)
        body = _get(api, seed_data, sections='transport,library').json()
        assert body['library'] is None
        assert body['transport'] is not None

    def test_other_school_data_is_not_leaked(self, seed_data, api):
        """Scoped by the caller's school, same as the standalone endpoints."""
        _enable(seed_data['school_a'], admissions=True)
        _enable(seed_data['school_b'], admissions=True)
        from admissions.models import AdmissionEnquiry
        before = _get(api, seed_data, sections='admissions').json()['admissions_new_count']
        AdmissionEnquiry.objects.create(
            school=seed_data['school_b'], name='Other School Child', father_name='P',
            mobile='0300', status='NEW',
        )
        after = _get(api, seed_data, sections='admissions').json()['admissions_new_count']
        assert after == before
