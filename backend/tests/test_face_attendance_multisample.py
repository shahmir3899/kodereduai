"""
Face Attendance — multi-sample enrollment (Phase 2)
===================================================
Covers: the same-student consistency / near-duplicate guard on enroll/, the
per-student sample cap (soft retire), and the enrollments/coverage/ endpoint.

Run:
    cd backend
    pytest tests/test_face_attendance_multisample.py -v
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from face_attendance.models import StudentFaceEmbedding

ENROLL_URL = '/api/face-attendance/enroll/'
COVERAGE_URL = '/api/face-attendance/enrollments/coverage/'
VERSION = 'faceapi_v1'


def _vec(x):
    """A 128-d vector whose distance to _vec(y) is exactly |x - y|."""
    v = [0.0] * 128
    v[0] = float(x)
    return v


def _enroll(api, seed_data, student, x, quality=0.8, **extra):
    payload = {
        'student_id': student.id,
        'embedding': _vec(x),
        'embedding_version': VERSION,
        'quality_score': quality,
        **extra,
    }
    return api.post(ENROLL_URL, payload, seed_data['tokens']['admin'], seed_data['SID_A'])


def _make_sample(student, x, quality=0.8):
    """Create a sample directly. The enroll/ duplicate-face check uses pgvector, which
    SQLite can't run once more than one student has embeddings, so coverage tests
    that need several enrolled students bypass the API."""
    import numpy as np
    vec = np.asarray(_vec(x), dtype=np.float64)
    return StudentFaceEmbedding.objects.create(
        student=student, school_id=student.school_id,
        embedding=vec.tobytes(), embedding_vector=vec.astype(np.float32).tolist(),
        embedding_version=VERSION, quality_score=quality,
    )


def _active(student):
    return StudentFaceEmbedding.objects.filter(
        student=student, embedding_version=VERSION, is_active=True,
    )


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestSampleGuards:
    def test_first_sample_has_nothing_to_compare_against(self, seed_data, api):
        student = seed_data['students'][0]
        assert _enroll(api, seed_data, student, 0.0).status_code == 201

    def test_second_similar_sample_is_accepted(self, seed_data, api):
        student = seed_data['students'][0]
        _enroll(api, seed_data, student, 0.0)
        assert _enroll(api, seed_data, student, 0.2).status_code == 201
        assert _active(student).count() == 2

    def test_far_sample_is_rejected_as_inconsistent(self, seed_data, api):
        student = seed_data['students'][0]
        _enroll(api, seed_data, student, 0.0)
        resp = _enroll(api, seed_data, student, 2.0)
        assert resp.status_code == 409
        assert resp.json()['error'] == 'inconsistent_face'
        assert _active(student).count() == 1

    def test_override_consistency_allows_far_sample(self, seed_data, api):
        student = seed_data['students'][0]
        _enroll(api, seed_data, student, 0.0)
        resp = _enroll(api, seed_data, student, 2.0, override_consistency=True)
        assert resp.status_code == 201
        assert _active(student).count() == 2

    def test_near_identical_sample_is_rejected(self, seed_data, api):
        student = seed_data['students'][0]
        _enroll(api, seed_data, student, 0.0)
        resp = _enroll(api, seed_data, student, 0.01)
        assert resp.status_code == 409
        assert resp.json()['error'] == 'sample_too_similar'

    def test_other_embedding_versions_are_not_compared(self, seed_data, api):
        """seed_data already gives the student a dlib_v1 row — a different vector space."""
        student = seed_data['students'][0]
        assert StudentFaceEmbedding.objects.filter(student=student, embedding_version='dlib_v1').exists()
        assert _enroll(api, seed_data, student, 5.0).status_code == 201


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestSampleCap:
    def test_sixth_sample_retires_the_lowest_quality_one(self, seed_data, api):
        student = seed_data['students'][0]
        qualities = [0.9, 0.8, 0.3, 0.7, 0.85]  # index 2 is the weakest
        for i, q in enumerate(qualities):
            assert _enroll(api, seed_data, student, i * 0.1, quality=q).status_code == 201
        assert _active(student).count() == 5

        assert _enroll(api, seed_data, student, 0.55, quality=0.6).status_code == 201

        active = _active(student)
        assert active.count() == 5
        assert not active.filter(quality_score=0.3).exists()
        retired = StudentFaceEmbedding.objects.get(student=student, embedding_version=VERSION, quality_score=0.3)
        assert retired.is_active is False  # soft retire, row kept

    def test_newest_sample_is_never_the_one_retired(self, seed_data, api):
        student = seed_data['students'][0]
        for i in range(5):
            _enroll(api, seed_data, student, i * 0.1, quality=0.9)
        # Lower quality than every existing sample, but it must still take effect.
        assert _enroll(api, seed_data, student, 0.55, quality=0.1).status_code == 201
        assert _active(student).filter(quality_score=0.1).exists()
        assert _active(student).count() == 5


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestCoverage:
    def _by_student(self, resp):
        return {r['student_id']: r for r in resp.json()['students']}

    def test_states_and_summary(self, seed_data, api):
        s_none, s_one, s_ok, s_old = seed_data['students'][:4]
        # seed_data enrolls dlib_v1 rows for some students; start from a clean slate.
        StudentFaceEmbedding.objects.all().delete()

        _make_sample(s_one, 0.0)
        for i in range(3):
            _make_sample(s_ok, i * 0.1)
        for i in range(3):
            _make_sample(s_old, i * 0.1)
        StudentFaceEmbedding.objects.filter(student=s_old).update(
            created_at=timezone.now() - timedelta(days=400),
        )

        resp = api.get(COVERAGE_URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, resp.content
        rows = self._by_student(resp)
        assert rows[s_none.id]['status'] == 'not_enrolled' and rows[s_none.id]['samples'] == 0
        assert rows[s_one.id]['status'] == 'needs_more' and rows[s_one.id]['samples'] == 1
        assert rows[s_ok.id]['status'] == 'ok' and rows[s_ok.id]['samples'] == 3
        assert rows[s_old.id]['status'] == 'refresh_due'

        summary = resp.json()['summary']
        assert summary['total'] == len(resp.json()['students'])
        assert summary['needs_more'] >= 1 and summary['refresh_due'] >= 1 and summary['ok'] >= 1

    def test_retired_samples_do_not_count(self, seed_data, api):
        student = seed_data['students'][0]
        StudentFaceEmbedding.objects.all().delete()
        _make_sample(student, 0.0)
        StudentFaceEmbedding.objects.filter(student=student).update(is_active=False)
        resp = api.get(COVERAGE_URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert self._by_student(resp)[student.id]['status'] == 'not_enrolled'

    def test_unauthenticated_rejected(self, seed_data, api):
        assert api.get_no_auth(COVERAGE_URL).status_code in (401, 403)
