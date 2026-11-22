"""POST /api/students/bulk_delete/: admin-only soft delete of several students."""
import pytest

from core.models import AdminActionLog
from students.models import Student

URL = '/api/students/bulk_delete/'


def bulk(api, ctx, ids, token='admin', **extra):
    body = {'student_ids': ids, 'reason': 'test entries', **extra}
    return api.post(URL, body, ctx['tokens'][token], ctx['SID_A'])


@pytest.mark.django_db
class TestBulkDelete:
    def test_soft_deletes_and_lists_in_recently_deleted(self, api, seed_data):
        a, b = seed_data['students'][0], seed_data['students'][1]
        resp = bulk(api, seed_data, [a.id, b.id])
        assert resp.status_code == 200
        assert sorted(resp.json()['deleted']) == sorted([a.id, b.id]) and resp.json()['skipped'] == []
        assert not Student.objects.filter(pk__in=[a.id, b.id]).exists()
        rows = Student.all_objects.filter(pk__in=[a.id, b.id], deleted_at__isnull=False)
        assert rows.count() == 2 and all(r.deleted_reason == 'test entries' for r in rows)
        assert AdminActionLog.objects.filter(action='soft_delete', target_id__in=[str(a.id), str(b.id)]).count() == 2

    @pytest.mark.parametrize('token', ['teacher', 'finance_manager', 'manager', 'staff'])
    def test_non_admins_refused(self, api, seed_data, token):
        s = seed_data['students'][0]
        assert bulk(api, seed_data, [s.id], token=token).status_code == 403
        assert Student.objects.filter(pk=s.id).exists()

    def test_reason_required(self, api, seed_data):
        resp = bulk(api, seed_data, [seed_data['students'][0].id], reason='  ')
        assert resp.status_code == 400 and resp.json()['code'] == 'reason_required'

    def test_ids_required_and_capped(self, api, seed_data):
        assert bulk(api, seed_data, []).json()['code'] == 'ids_required'
        too_many = bulk(api, seed_data, list(range(1, 102)))
        assert too_many.status_code == 400 and too_many.json()['code'] == 'too_many'

    def test_other_school_student_is_not_touched(self, api, seed_data):
        from students.models import Class
        # The seed has students in school A only; borrow the shared school B for one of theirs.
        mine = seed_data['students'][0]
        cls_b = Class.objects.create(school=seed_data['school_b'], name='B_Class', section='A', grade_level=1)
        theirs = Student.objects.create(
            school=seed_data['school_b'], class_obj=cls_b, roll_number='1', name='Other School Student',
        )
        resp = bulk(api, seed_data, [mine.id, theirs.id])
        assert resp.status_code == 200
        assert resp.json()['deleted'] == [mine.id]
        assert resp.json()['skipped'][0]['code'] == 'not_found'
        assert Student.objects.filter(pk=theirs.id).exists()

    def test_transfer_linked_student_is_skipped_and_rest_go_through(self, api, seed_data):
        linked, plain = seed_data['students'][0], seed_data['students'][1]
        Student.objects.filter(pk=linked.pk).update(transferred_from=seed_data['students'][3])
        resp = bulk(api, seed_data, [linked.id, plain.id])
        assert resp.json()['deleted'] == [plain.id]
        assert resp.json()['skipped'][0]['code'] == 'transfer_linked'
        assert Student.objects.filter(pk=linked.pk).exists()
