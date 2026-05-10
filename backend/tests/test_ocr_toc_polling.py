"""
OCR TOC Polling Fix — Backend Tests
=====================================
Verifies the upload-then-poll flow that replaces the old single long-running
HTTP connection. Covers:
  - async=1 always creates a TOCImportJob (even with ENABLE_CELERY=false)
  - background thread transitions job from QUEUED → PROCESSING → SUCCEEDED
  - poll endpoint returns correct status at each stage
  - FAILED and TIMED_OUT jobs surface their error via the poll endpoint
  - synchronous fallback (no async=1) still works for non-mobile clients
  - school isolation on the poll endpoint
  - missing / bad image returns 400 without creating a job

Run:
    cd backend
    pytest tests/test_ocr_toc_polling.py -v
"""

import base64
import uuid
from unittest.mock import MagicMock, patch

import pytest

from lms.models import TOCImportJob

P = "POCT_"   # test prefix


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tiny_jpeg() -> bytes:
    """Return the smallest valid JPEG (1×1 white pixel)."""
    return (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
        b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
        b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e\xc0"
        b"\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00"
        b"\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
        b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01"
        b"\x01\x00\x00?\x00\xfb\xd4P\x00\x00\x00\xff\xd9"
    )


def _upload_ocr_async(api, token, sid, book_id, image_bytes=None, content_type="image/jpeg"):
    """POST to ocr_toc with async=1 and return the response."""
    if image_bytes is None:
        image_bytes = _tiny_jpeg()
    from django.core.files.uploadedfile import SimpleUploadedFile
    img_file = SimpleUploadedFile("toc.jpg", image_bytes, content_type=content_type)
    return api.post_multipart(
        f"/api/lms/books/{book_id}/ocr_toc/?async=1",
        {"image": img_file},
        token,
        sid,
    )


def _poll_job(api, token, sid, job_id):
    return api.get(f"/api/lms/toc-jobs/{job_id}/", token, sid)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def ocr_book(seed_data):
    """A Book for OCR tests in school_a."""
    from lms.models import Book
    return Book.objects.create(
        school=seed_data["school_a"],
        class_obj=seed_data["classes"][0],
        subject=seed_data["subjects"][0],
        title=f"{P}OCR Book",
        language="en",
    )


@pytest.fixture
def ocr_book_b(seed_data):
    """A Book in school_b for isolation tests."""
    from lms.models import Book
    return Book.objects.create(
        school=seed_data["school_b"],
        class_obj=seed_data["classes"][0],
        subject=seed_data["subjects"][0],
        title=f"{P}OCR Book B",
        language="en",
    )


# ---------------------------------------------------------------------------
# Level A: Job creation via async=1
# ---------------------------------------------------------------------------

@pytest.mark.django_db(transaction=True)
class TestOcrJobCreation:

    def test_async_upload_returns_202_with_job_id(self, seed_data, api, ocr_book):
        """async=1 must return 202 Accepted with job_id regardless of Celery setting."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        with patch("lms.views._process_toc_job_in_background") as mock_thread, \
             patch("lms.views.process_toc_import_job") as mock_celery:
            mock_thread.return_value = None
            mock_celery.delay = MagicMock()

            resp = _upload_ocr_async(api, token, sid, ocr_book.id)

        assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.content}"
        body = resp.json()
        assert "job_id" in body, "Response must contain job_id"
        assert "poll_url" in body, "Response must contain poll_url"
        assert body["status"] == "QUEUED"

    def test_async_creates_toc_import_job_record(self, seed_data, api, ocr_book):
        """A TOCImportJob row must be created in the database."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        with patch("lms.views._process_toc_job_in_background"), \
             patch("lms.views.process_toc_import_job"):
            resp = _upload_ocr_async(api, token, sid, ocr_book.id)

        job_id = resp.json()["job_id"]
        job = TOCImportJob.objects.get(id=job_id)
        assert job.book_id == ocr_book.id
        assert job.school_id == seed_data["SID_A"]

    def test_async_without_celery_calls_thread_worker(self, seed_data, api, ocr_book):
        """When ENABLE_CELERY is false, _process_toc_job_in_background must be called."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        with patch("lms.views.process_toc_import_job") as mock_celery, \
             patch("lms.views._process_toc_job_in_background") as mock_thread, \
             patch("django.conf.settings.LMS_TOC_OCR_ASYNC_JOBS_ENABLED", False):
            mock_thread.return_value = None
            resp = _upload_ocr_async(api, token, sid, ocr_book.id)

        assert resp.status_code == 202
        mock_thread.assert_called_once()
        mock_celery.delay.assert_not_called()

    def test_async_with_celery_calls_celery_task(self, seed_data, api, ocr_book):
        """When ENABLE_CELERY is true, Celery task must be dispatched."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        with patch("lms.views.process_toc_import_job") as mock_celery, \
             patch("lms.views._process_toc_job_in_background") as mock_thread, \
             patch("django.conf.settings.LMS_TOC_OCR_ASYNC_JOBS_ENABLED", True):
            mock_celery.delay = MagicMock()
            resp = _upload_ocr_async(api, token, sid, ocr_book.id)

        assert resp.status_code == 202
        mock_celery.delay.assert_called_once()
        mock_thread.assert_not_called()

    def test_missing_image_returns_400(self, seed_data, api, ocr_book):
        """Uploading without an image file must return 400."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post(
            f"/api/lms/books/{ocr_book.id}/ocr_toc/?async=1",
            {},
            token,
            sid,
        )
        assert resp.status_code == 400
        assert TOCImportJob.objects.filter(book=ocr_book).count() == 0

    def test_invalid_content_type_returns_400(self, seed_data, api, ocr_book):
        """Uploading a PDF (wrong MIME type) must return 400."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        from django.core.files.uploadedfile import SimpleUploadedFile
        pdf_file = SimpleUploadedFile("toc.pdf", b"%PDF-1.4 ...", content_type="application/pdf")
        resp = api.post_multipart(
            f"/api/lms/books/{ocr_book.id}/ocr_toc/?async=1",
            {"image": pdf_file},
            token,
            sid,
        )
        assert resp.status_code == 400
        assert TOCImportJob.objects.filter(book=ocr_book).count() == 0

    def test_sync_fallback_still_works(self, seed_data, api, ocr_book):
        """Without async=1, the synchronous OCR path must still return 200 with text."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        mock_payload = {"text": "Chapter 1\nTopic A", "lines": []}

        from django.core.files.uploadedfile import SimpleUploadedFile
        img = SimpleUploadedFile("toc.jpg", _tiny_jpeg(), content_type="image/jpeg")

        with patch("lms.toc_ocr.extract_toc_payload", return_value=(mock_payload, None)):
            resp = api.post_multipart(
                f"/api/lms/books/{ocr_book.id}/ocr_toc/",
                {"image": img},
                token,
                sid,
            )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.content}"
        body = resp.json()
        assert "text" in body
        assert "Chapter 1" in body["text"]


# ---------------------------------------------------------------------------
# Level B: Poll endpoint
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestOcrJobPoll:

    def _make_job(self, seed_data, ocr_book, status=TOCImportJob.Status.QUEUED, result=None, error=""):
        return TOCImportJob.objects.create(
            school=seed_data["school_a"],
            book=ocr_book,
            status=status,
            image_payload_b64="",
            result_payload=result or {},
            error_message=error,
        )

    def test_poll_queued_job(self, seed_data, api, ocr_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        job = self._make_job(seed_data, ocr_book, TOCImportJob.Status.QUEUED)

        resp = _poll_job(api, token, sid, job.id)
        assert resp.status_code == 200
        assert resp.json()["status"] == "QUEUED"

    def test_poll_processing_job(self, seed_data, api, ocr_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        job = self._make_job(seed_data, ocr_book, TOCImportJob.Status.PROCESSING)

        resp = _poll_job(api, token, sid, job.id)
        assert resp.status_code == 200
        assert resp.json()["status"] == "PROCESSING"

    def test_poll_succeeded_job_has_result(self, seed_data, api, ocr_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        result_data = {"text": "Chapter 1\nTopic A", "lines": [], "language": "en"}
        job = self._make_job(seed_data, ocr_book, TOCImportJob.Status.SUCCEEDED, result=result_data)

        resp = _poll_job(api, token, sid, job.id)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "SUCCEEDED"
        assert body["result"]["text"] == "Chapter 1\nTopic A"

    def test_poll_failed_job_has_error(self, seed_data, api, ocr_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        job = self._make_job(seed_data, ocr_book, TOCImportJob.Status.FAILED, error="Vision API error")

        resp = _poll_job(api, token, sid, job.id)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "FAILED"
        assert "Vision API error" in body.get("error_message", "")

    def test_poll_timed_out_job(self, seed_data, api, ocr_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        job = self._make_job(seed_data, ocr_book, TOCImportJob.Status.TIMED_OUT, error="Timed out")

        resp = _poll_job(api, token, sid, job.id)
        assert resp.status_code == 200
        assert resp.json()["status"] == "TIMED_OUT"

    def test_poll_nonexistent_job_returns_404(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = _poll_job(api, token, sid, uuid.uuid4())
        assert resp.status_code == 404

    def test_poll_requires_authentication(self, api, ocr_book, seed_data):
        """Unauthenticated poll must be rejected."""
        job = TOCImportJob.objects.create(
            school=seed_data["school_a"],
            book=ocr_book,
            status=TOCImportJob.Status.QUEUED,
        )
        resp = api.get_no_auth(f"/api/lms/toc-jobs/{job.id}/")
        assert resp.status_code in (401, 403)

    def test_poll_school_isolation(self, seed_data, api, ocr_book_b):
        """School A admin cannot see a job belonging to school B."""
        token_a = seed_data["tokens"]["admin"]   # school A admin
        sid_a = seed_data["SID_A"]
        job_b = TOCImportJob.objects.create(
            school=seed_data["school_b"],
            book=ocr_book_b,
            status=TOCImportJob.Status.QUEUED,
        )
        resp = _poll_job(api, token_a, sid_a, job_b.id)
        assert resp.status_code == 404, "School A admin must not access school B job"


# ---------------------------------------------------------------------------
# Level C: Background thread worker
# ---------------------------------------------------------------------------

@pytest.mark.django_db(transaction=True)
class TestBackgroundThreadWorker:

    def _run_worker_synchronously(self, job_id: str, patch_target=None, patch_value=None, patch_side_effect=None):
        """
        Run the background thread worker and block until it finishes.
        Optionally patches `lms.toc_ocr.extract_toc_payload` during the run.
        Returns a mock object if patching was requested, else None.
        """
        import threading
        from lms.views import _process_toc_job_in_background

        thread_ref = []
        original_thread_class = threading.Thread

        def capture_thread(*args, **kwargs):
            t = original_thread_class(*args, **kwargs)
            thread_ref.append(t)
            return t

        mock_ocr = None
        ctx = patch("threading.Thread", side_effect=capture_thread)
        ctx2 = None
        if patch_target:
            if patch_side_effect:
                ctx2 = patch(patch_target, side_effect=patch_side_effect)
            else:
                ctx2 = patch(patch_target, return_value=patch_value)

        with ctx:
            if ctx2:
                with ctx2 as mock_ocr:
                    _process_toc_job_in_background(job_id)
            else:
                _process_toc_job_in_background(job_id)

        # Join the actual thread to wait for completion
        if thread_ref:
            thread_ref[0].join(timeout=5)

        return mock_ocr

    def test_thread_worker_transitions_job_to_succeeded(self, seed_data, ocr_book):
        """_process_toc_job_in_background must set status=SUCCEEDED and store result."""
        image_bytes = _tiny_jpeg()
        job = TOCImportJob.objects.create(
            school=seed_data["school_a"],
            book=ocr_book,
            status=TOCImportJob.Status.QUEUED,
            image_payload_b64=base64.b64encode(image_bytes).decode(),
        )

        mock_payload = {"text": "Chapter 1\nTopic A", "lines": []}
        self._run_worker_synchronously(
            str(job.id),
            patch_target="lms.toc_ocr.extract_toc_payload",
            patch_value=(mock_payload, None),
        )

        job.refresh_from_db()
        assert job.status == TOCImportJob.Status.SUCCEEDED
        assert "Chapter 1" in job.result_payload.get("text", "")
        assert job.image_payload_b64 == ""  # Payload cleared after success

    def test_thread_worker_transitions_job_to_failed_on_ocr_error(self, seed_data, ocr_book):
        """When extract_toc_payload returns an error, job must end as FAILED."""
        job = TOCImportJob.objects.create(
            school=seed_data["school_a"],
            book=ocr_book,
            status=TOCImportJob.Status.QUEUED,
            image_payload_b64=base64.b64encode(_tiny_jpeg()).decode(),
        )

        self._run_worker_synchronously(
            str(job.id),
            patch_target="lms.toc_ocr.extract_toc_payload",
            patch_value=(None, "Vision API unavailable"),
        )

        job.refresh_from_db()
        assert job.status == TOCImportJob.Status.FAILED
        assert "Vision API unavailable" in job.error_message

    def test_thread_worker_transitions_job_to_failed_on_exception(self, seed_data, ocr_book):
        """An unexpected exception in the worker must set FAILED, not leave it stuck."""
        job = TOCImportJob.objects.create(
            school=seed_data["school_a"],
            book=ocr_book,
            status=TOCImportJob.Status.QUEUED,
            image_payload_b64=base64.b64encode(_tiny_jpeg()).decode(),
        )

        self._run_worker_synchronously(
            str(job.id),
            patch_target="lms.toc_ocr.extract_toc_payload",
            patch_side_effect=RuntimeError("Unexpected crash"),
        )

        job.refresh_from_db()
        assert job.status == TOCImportJob.Status.FAILED
        assert "Unexpected crash" in job.error_message

    def test_thread_worker_skips_already_completed_job(self, seed_data, ocr_book):
        """Worker must be a no-op if job is already SUCCEEDED."""
        job = TOCImportJob.objects.create(
            school=seed_data["school_a"],
            book=ocr_book,
            status=TOCImportJob.Status.SUCCEEDED,
            result_payload={"text": "already done"},
            image_payload_b64="",
        )

        mock_ocr = self._run_worker_synchronously(
            str(job.id),
            patch_target="lms.toc_ocr.extract_toc_payload",
            patch_value=({"text": "should not be called"}, None),
        )

        if mock_ocr:
            mock_ocr.assert_not_called()
        job.refresh_from_db()
        assert job.status == TOCImportJob.Status.SUCCEEDED

    def test_thread_worker_nonexistent_job_does_not_raise(self):
        """A missing job_id must not crash the thread (just log and return)."""
        # Should not raise; join ensures the thread completes
        self._run_worker_synchronously(str(uuid.uuid4()))
