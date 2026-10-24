"""
Library polish pass: school-scoped ids, search params, OVERDUE counted as still out,
derived copy counts, delete guard, read-only issue rows and the stats contract.

Run:
    cd backend
    pytest tests/test_library_polish.py -v
"""

from datetime import date, timedelta

import pytest

from library.models import Book, BookIssue, LibraryConfiguration

P = "LIBPOL_"


def _admin(seed_data):
    return seed_data["tokens"]["admin"], seed_data["SID_A"]


def _book(api, seed_data, title="Algebra", copies=2, **extra):
    token, sid = _admin(seed_data)
    resp = api.post(
        "/api/library/books/",
        {"title": f"{P}{title}", "author": "A. Khan", "total_copies": copies, **extra},
        token, sid,
    )
    assert resp.status_code == 201, resp.json()
    return resp.json()["id"]


def _issue(api, seed_data, book_id, student=None, days=14):
    token, sid = _admin(seed_data)
    return api.post(
        "/api/library/issues/",
        {"book": book_id, "borrower_type": "STUDENT",
         "student": (student or seed_data["students"][0]).id,
         "due_date": str(date.today() + timedelta(days=days))},
        token, sid,
    )


def _results(resp):
    data = resp.json()
    return data["results"] if isinstance(data, dict) else data


@pytest.mark.django_db
class TestLibraryPolish:

    def test_issue_rejects_other_schools_ids(self, seed_data, api):
        book_id = _book(api, seed_data)
        resp = api.post(
            "/api/library/issues/",
            {"book": book_id, "borrower_type": "STUDENT",
             "student": seed_data["students"][0].id,
             "due_date": str(date.today() + timedelta(days=7))},
            seed_data["tokens"]["admin_b"], seed_data["SID_B"],
        )
        assert resp.status_code == 400
        assert {"book", "student"} <= set(resp.json())

    def test_book_rejects_other_schools_category(self, seed_data, api):
        token, sid = _admin(seed_data)
        cat = api.post("/api/library/categories/", {"name": f"{P}Sci"}, token, sid).json()["id"]
        resp = api.post(
            "/api/library/books/",
            {"title": f"{P}X", "author": "Y", "total_copies": 1, "category": cat},
            seed_data["tokens"]["admin_b"], seed_data["SID_B"],
        )
        assert resp.status_code == 400
        assert "category" in resp.json()

    def test_duplicate_category_is_a_400_not_a_500(self, seed_data, api):
        token, sid = _admin(seed_data)
        assert api.post("/api/library/categories/", {"name": f"{P}Fiction"}, token, sid).status_code == 201
        resp = api.post("/api/library/categories/", {"name": f"{P.lower()}FICTION"}, token, sid)
        assert resp.status_code == 400

    def test_book_search_param(self, seed_data, api):
        token, sid = _admin(seed_data)
        _book(api, seed_data, "Geometry")
        _book(api, seed_data, "Atlas")
        titles = [b["title"] for b in _results(api.get("/api/library/books/?search=geom", token, sid))]
        assert titles == [f"{P}Geometry"]

    def test_issue_search_param(self, seed_data, api):
        token, sid = _admin(seed_data)
        book_id = _book(api, seed_data, "Poetry")
        student = seed_data["students"][0]
        assert _issue(api, seed_data, book_id, student).status_code == 201
        hit = _results(api.get(f"/api/library/issues/?search={student.name[:6]}", token, sid))
        miss = _results(api.get("/api/library/issues/?search=zzzznomatch", token, sid))
        assert len(hit) >= 1 and miss == []

    def test_available_copies_are_derived(self, seed_data, api):
        token, sid = _admin(seed_data)
        book_id = _book(api, seed_data, "Derived", copies=3, available_copies=99)
        assert Book.objects.get(pk=book_id).available_copies == 3
        assert _issue(api, seed_data, book_id).status_code == 201
        # raising the total adds the new copies to what is on the shelf
        resp = api.patch(f"/api/library/books/{book_id}/", {"total_copies": 5}, token, sid)
        assert resp.status_code == 200
        assert Book.objects.get(pk=book_id).available_copies == 4

    def test_total_copies_cannot_drop_below_issued(self, seed_data, api):
        token, sid = _admin(seed_data)
        book_id = _book(api, seed_data, "Floor", copies=2)
        _issue(api, seed_data, book_id, seed_data["students"][0])
        _issue(api, seed_data, book_id, seed_data["students"][1])
        resp = api.patch(f"/api/library/books/{book_id}/", {"total_copies": 1}, token, sid)
        assert resp.status_code == 400
        assert "total_copies" in resp.json()

    def test_book_with_history_cannot_be_deleted(self, seed_data, api):
        token, sid = _admin(seed_data)
        used = _book(api, seed_data, "Used")
        _issue(api, seed_data, used)
        resp = api.delete(f"/api/library/books/{used}/", token, sid)
        assert resp.status_code == 400
        assert Book.objects.filter(pk=used).exists()
        unused = _book(api, seed_data, "Unused")
        assert api.delete(f"/api/library/books/{unused}/", token, sid).status_code == 204

    def test_issue_rows_are_not_editable_or_deletable(self, seed_data, api):
        token, sid = _admin(seed_data)
        issue_id = _issue(api, seed_data, _book(api, seed_data, "Fixed")).json()["id"]
        assert api.patch(f"/api/library/issues/{issue_id}/", {"status": "RETURNED"}, token, sid).status_code == 405
        assert api.delete(f"/api/library/issues/{issue_id}/", token, sid).status_code == 405

    def test_past_due_date_and_same_borrower_twice_rejected(self, seed_data, api):
        book_id = _book(api, seed_data, "Twice", copies=3)
        assert _issue(api, seed_data, book_id, days=-1).status_code == 400
        assert _issue(api, seed_data, book_id).status_code == 201
        assert _issue(api, seed_data, book_id).status_code == 400

    def test_inactive_book_cannot_be_issued(self, seed_data, api):
        book_id = _book(api, seed_data, "Shelved", is_active=False)
        assert _issue(api, seed_data, book_id).status_code == 400

    def test_overdue_status_still_counts_and_can_be_returned(self, seed_data, api):
        token, sid = _admin(seed_data)
        LibraryConfiguration.objects.update_or_create(
            school_id=sid, defaults={"fine_per_day": 7, "max_books_student": 1},
        )
        book_id = _book(api, seed_data, "Late", copies=2)
        issue_id = _issue(api, seed_data, book_id).json()["id"]
        # the reminder job flips ISSUED to OVERDUE; make it also past due
        BookIssue.objects.filter(pk=issue_id).update(
            status="OVERDUE", due_date=date.today() - timedelta(days=3),
        )
        stats = api.get("/api/library/stats/", token, sid).json()
        assert stats["total_issued"] >= 1 and stats["total_overdue"] >= 1
        assert {"total_titles", "total_copies", "most_issued_books"} <= set(stats)
        # still out: shows in the overdue list and the open filter, and the limit still applies
        assert issue_id in [i["id"] for i in _results(api.get("/api/library/issues/overdue/", token, sid))]
        assert issue_id in [i["id"] for i in _results(api.get("/api/library/issues/?status=ISSUED,OVERDUE", token, sid))]
        assert _issue(api, seed_data, _book(api, seed_data, "Other")).status_code == 400
        resp = api.post(f"/api/library/issues/{issue_id}/return_book/", {}, token, sid)
        assert resp.status_code == 200
        assert float(resp.json()["fine_amount"]) == 21.0
        assert Book.objects.get(pk=book_id).available_copies == 2

    def test_estimated_fine_is_visible_to_a_teacher(self, seed_data, api):
        token, sid = _admin(seed_data)
        LibraryConfiguration.objects.update_or_create(school_id=sid, defaults={"fine_per_day": 5})
        issue_id = _issue(api, seed_data, _book(api, seed_data, "Fine")).json()["id"]
        BookIssue.objects.filter(pk=issue_id).update(due_date=date.today() - timedelta(days=4))
        resp = api.get("/api/library/issues/overdue/", seed_data["tokens"]["teacher"], sid)
        assert resp.status_code == 200
        row = next(i for i in _results(resp) if i["id"] == issue_id)
        assert row["days_overdue"] == 4 and float(row["estimated_fine"]) == 20.0
        # but a teacher cannot read the config or return the book
        assert api.get("/api/library/config/", seed_data["tokens"]["teacher"], sid).status_code == 403
        assert api.post(f"/api/library/issues/{issue_id}/return_book/", {}, seed_data["tokens"]["teacher"], sid).status_code == 403
