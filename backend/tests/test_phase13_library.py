"""
Phase 13 -- Library Module Tests (pytest)
==========================================
Covers: BookCategory CRUD, Book CRUD + search + issue, BookIssue + return,
        LibraryConfig, LibraryStats, permissions, school isolation.

Run:
    cd backend
    pytest tests/test_phase13_library.py -v
"""

import pytest
from datetime import date, timedelta

from library.models import BookCategory, Book, BookIssue, LibraryConfiguration

P13 = "P13LIB_"


# ======================================================================
# LEVEL A: BOOK CATEGORIES CRUD
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase13
class TestBookCategories:
    """Book category CRUD operations and permissions."""

    def test_a1_create_category_admin(self, seed_data, api):
        """Admin can create a book category."""
        resp = api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}Science',
            'description': 'Science books',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_a2_create_second_category(self, seed_data, api):
        """Admin can create a second category."""
        resp = api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}Fiction',
            'description': 'Fiction books',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_a3_duplicate_category_name_rejected(self, seed_data, api):
        """Duplicate category name in the same school is rejected with 400."""
        # Create first
        api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}DupCat',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        # Duplicate
        resp = api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}DupCat',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"

    def test_a4_teacher_cannot_create_category(self, seed_data, api):
        """Teacher cannot create a category (403)."""
        resp = api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}Teacher Cat',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_a5_list_categories(self, seed_data, api):
        """Admin can list categories and sees created ones."""
        # Ensure at least two categories exist
        api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}ListCat1',
            'description': 'Cat 1',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        api.post('/api/library/categories/', {
            'school': seed_data['SID_A'],
            'name': f'{P13}ListCat2',
            'description': 'Cat 2',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/library/categories/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        if isinstance(data, dict):
            data = data.get('results', [])
        assert len(data) >= 2, f"Expected >= 2 categories, got {len(data)}"

    def test_a6_teacher_can_read_categories(self, seed_data, api):
        """Teacher can read (list) categories."""
        resp = api.get('/api/library/categories/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_a7_school_b_isolation(self, seed_data, api):
        """School B admin sees no categories from School A."""
        resp = api.get('/api/library/categories/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        if isinstance(data, dict):
            data = data.get('results', [])
        assert len(data) == 0, f"Expected 0 categories for School B, got {len(data)}"


# ======================================================================
# LEVEL B: BOOKS CRUD + SEARCH
# ======================================================================


@pytest.fixture
def category_for_books(seed_data, api):
    """Create a category to be used by book tests."""
    resp = api.post('/api/library/categories/', {
        'school': seed_data['SID_A'],
        'name': f'{P13}BookTestCat',
        'description': 'Category for book tests',
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 201, f"Failed to create category fixture: {resp.status_code}"
    return resp.json()['id']


@pytest.mark.django_db
@pytest.mark.phase13
class TestBooks:
    """Book CRUD operations, search, and school isolation."""

    def test_b1_create_book_admin(self, seed_data, api, category_for_books):
        """Admin can create a book."""
        resp = api.post('/api/library/books/', {
            'title': f'{P13}Physics 101',
            'author': 'Dr. Khan',
            'isbn': f'{P13}ISBN001',
            'category': category_for_books,
            'total_copies': 5,
            'available_copies': 5,
            'shelf_location': 'A1',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_b2_create_second_book(self, seed_data, api, category_for_books):
        """Admin can create a second book."""
        resp = api.post('/api/library/books/', {
            'title': f'{P13}Chemistry Basics',
            'author': 'Prof. Ali',
            'isbn': f'{P13}ISBN002',
            'category': category_for_books,
            'total_copies': 3,
            'available_copies': 3,
            'shelf_location': 'A2',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_b3_teacher_cannot_create_book(self, seed_data, api):
        """Teacher cannot create a book (403)."""
        resp = api.post('/api/library/books/', {
            'title': f'{P13}Teacher Book',
            'author': 'Teacher',
            'total_copies': 1,
            'available_copies': 1,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_b4_list_books(self, seed_data, api, category_for_books):
        """Admin can list books and sees created ones."""
        # Create two books
        api.post('/api/library/books/', {
            'title': f'{P13}ListBook1',
            'author': 'Author 1',
            'isbn': f'{P13}ISBNL1',
            'category': category_for_books,
            'total_copies': 1,
            'available_copies': 1,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        api.post('/api/library/books/', {
            'title': f'{P13}ListBook2',
            'author': 'Author 2',
            'isbn': f'{P13}ISBNL2',
            'category': category_for_books,
            'total_copies': 1,
            'available_copies': 1,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/library/books/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        if isinstance(data, dict):
            data = data.get('results', [])
        assert len(data) >= 2, f"Expected >= 2 books, got {len(data)}"

    def test_b5_search_books(self, seed_data, api, category_for_books):
        """Search books endpoint works."""
        # Ensure a book exists to search for
        api.post('/api/library/books/', {
            'title': f'{P13}Physics Searchable',
            'author': 'Dr. Search',
            'isbn': f'{P13}ISBNS1',
            'category': category_for_books,
            'total_copies': 1,
            'available_copies': 1,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/library/books/search/?q=Physics', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_b6_retrieve_single_book(self, seed_data, api, category_for_books):
        """Admin can retrieve a single book by ID."""
        resp = api.post('/api/library/books/', {
            'title': f'{P13}Retrieve Book',
            'author': 'Author R',
            'isbn': f'{P13}ISBNR1',
            'category': category_for_books,
            'total_copies': 5,
            'available_copies': 5,
            'shelf_location': 'A1',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        book_id = resp.json()['id']

        resp = api.get(f'/api/library/books/{book_id}/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_b7_update_book(self, seed_data, api, category_for_books):
        """Admin can update (patch) a book."""
        resp = api.post('/api/library/books/', {
            'title': f'{P13}Update Book',
            'author': 'Author U',
            'isbn': f'{P13}ISBNU1',
            'category': category_for_books,
            'total_copies': 5,
            'available_copies': 5,
            'shelf_location': 'A1',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        book_id = resp.json()['id']

        resp = api.patch(f'/api/library/books/{book_id}/', {
            'shelf_location': 'B1-Updated',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_b8_school_b_isolation(self, seed_data, api):
        """School B admin sees no books from School A."""
        resp = api.get('/api/library/books/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        if isinstance(data, dict):
            data = data.get('results', [])
        assert len(data) == 0, f"Expected 0 books for School B, got {len(data)}"


# ======================================================================
# LEVEL C: BOOK ISSUE + RETURN
# ======================================================================


@pytest.fixture
def issued_book_setup(seed_data, api):
    """Create a category and two books for issue/return tests. Returns dict with IDs."""
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']

    # Category
    resp = api.post('/api/library/categories/', {
        'school': sid,
        'name': f'{P13}IssueCat',
        'description': 'Category for issue tests',
    }, token, sid)
    assert resp.status_code == 201
    cat_id = resp.json()['id']

    # Book 1 (5 copies)
    resp = api.post('/api/library/books/', {
        'title': f'{P13}IssueBook1',
        'author': 'Dr. Issue',
        'isbn': f'{P13}ISBNI1',
        'category': cat_id,
        'total_copies': 5,
        'available_copies': 5,
        'shelf_location': 'I1',
    }, token, sid)
    assert resp.status_code == 201
    book1_id = resp.json()['id']

    # Book 2 (3 copies)
    resp = api.post('/api/library/books/', {
        'title': f'{P13}IssueBook2',
        'author': 'Prof. Issue',
        'isbn': f'{P13}ISBNI2',
        'category': cat_id,
        'total_copies': 3,
        'available_copies': 3,
        'shelf_location': 'I2',
    }, token, sid)
    assert resp.status_code == 201
    book2_id = resp.json()['id']

    return {
        'cat_id': cat_id,
        'book1_id': book1_id,
        'book2_id': book2_id,
    }


@pytest.mark.django_db
@pytest.mark.phase13
class TestBookIssue:
    """Book issue and return operations."""

    def test_c1_issue_book_to_student(self, seed_data, api, issued_book_setup):
        """Admin can issue a book to a student."""
        student = seed_data['students'][0]
        book_id = issued_book_setup['book1_id']
        resp = api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STUDENT',
            'student': student.id,
            'due_date': str(date.today() + timedelta(days=14)),
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_c2_available_copies_decreased_after_issue(self, seed_data, api, issued_book_setup):
        """Available copies decrease after issuing a book."""
        student = seed_data['students'][0]
        book_id = issued_book_setup['book1_id']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Issue the book
        resp = api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STUDENT',
            'student': student.id,
            'due_date': str(date.today() + timedelta(days=14)),
        }, token, sid)
        assert resp.status_code == 201

        # Check available copies
        resp = api.get(f'/api/library/books/{book_id}/', token, sid)
        assert resp.status_code == 200
        avail = resp.json().get('available_copies', -1)
        assert avail == 4, f"Expected 4 available copies, got {avail}"

    def test_c3_list_issues(self, seed_data, api, issued_book_setup):
        """Admin can list book issues."""
        student = seed_data['students'][0]
        book_id = issued_book_setup['book1_id']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Issue a book first
        api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STUDENT',
            'student': student.id,
            'due_date': str(date.today() + timedelta(days=14)),
        }, token, sid)

        resp = api.get('/api/library/issues/', token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        if isinstance(data, dict):
            data = data.get('results', [])
        assert len(data) >= 1, f"Expected >= 1 issues, got {len(data)}"

    def test_c4_return_book(self, seed_data, api, issued_book_setup):
        """Admin can return a book."""
        student = seed_data['students'][0]
        book_id = issued_book_setup['book1_id']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Issue the book
        resp = api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STUDENT',
            'student': student.id,
            'due_date': str(date.today() + timedelta(days=14)),
        }, token, sid)
        assert resp.status_code == 201
        issue_id = resp.json()['id']

        # Return it
        resp = api.post(f'/api/library/issues/{issue_id}/return_book/', {}, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_c5_available_copies_restored_after_return(self, seed_data, api, issued_book_setup):
        """Available copies are restored after returning a book."""
        student = seed_data['students'][0]
        book_id = issued_book_setup['book1_id']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Issue
        resp = api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STUDENT',
            'student': student.id,
            'due_date': str(date.today() + timedelta(days=14)),
        }, token, sid)
        assert resp.status_code == 201
        issue_id = resp.json()['id']

        # Return
        resp = api.post(f'/api/library/issues/{issue_id}/return_book/', {}, token, sid)
        assert resp.status_code == 200

        # Check copies restored
        resp = api.get(f'/api/library/books/{book_id}/', token, sid)
        assert resp.status_code == 200
        avail = resp.json().get('available_copies', -1)
        assert avail == 5, f"Expected 5 available copies, got {avail}"

    def test_c6_issue_book_to_staff(self, seed_data, api, issued_book_setup):
        """Admin can issue a book to a staff member."""
        staff_member = seed_data['staff'][0]
        book_id = issued_book_setup['book2_id']
        resp = api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STAFF',
            'staff': staff_member.id,
            'due_date': str(date.today() + timedelta(days=30)),
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_c7_overdue_list_endpoint(self, seed_data, api):
        """Overdue list endpoint returns 200."""
        resp = api.get('/api/library/issues/overdue/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"


# ======================================================================
# LEVEL D: LIBRARY CONFIG & STATS
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase13
class TestLibraryConfig:
    """Library configuration and statistics endpoints."""

    def test_d1_get_library_config(self, seed_data, api):
        """Get library config (auto-creates if needed)."""
        resp = api.get('/api/library/config/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_d2_update_library_config(self, seed_data, api):
        """Admin can update library config."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Ensure config exists first
        api.get('/api/library/config/', token, sid)

        resp = api.patch('/api/library/config/', {
            'max_books_student': 5,
            'loan_period_days': 21,
        }, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_d3_teacher_cannot_update_config(self, seed_data, api):
        """Teacher cannot update library config (403)."""
        resp = api.patch('/api/library/config/', {
            'max_books_student': 10,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_d4_get_library_stats(self, seed_data, api):
        """Admin can get library stats."""
        resp = api.get('/api/library/stats/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_d5_stats_has_expected_fields(self, seed_data, api):
        """Stats response contains total_books and total_issued fields."""
        resp = api.get('/api/library/stats/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        stats = resp.json()
        assert 'total_books' in stats, f"Missing 'total_books' in stats keys: {list(stats.keys())}"
        assert 'total_issued' in stats, f"Missing 'total_issued' in stats keys: {list(stats.keys())}"


# ======================================================================
# LEVEL E: PERMISSIONS & CROSS-CUTTING
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase13
class TestLibraryPermissions:
    """Permission checks and cross-cutting concerns."""

    def test_e1_unauthenticated_returns_401(self, seed_data, api):
        """Unauthenticated request to books endpoint returns 401."""
        resp = api.client.get('/api/library/books/')
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_e2_invalid_token_returns_401(self, seed_data, api):
        """Invalid bearer token returns 401."""
        resp = api.client.get(
            '/api/library/books/',
            HTTP_AUTHORIZATION='Bearer garbage_token',
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_e3_teacher_can_read_books(self, seed_data, api):
        """Teacher can read (list) books."""
        resp = api.get('/api/library/books/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_e4_teacher_cannot_issue_book(self, seed_data, api, issued_book_setup):
        """Teacher cannot issue a book (403)."""
        student = seed_data['students'][0]
        book_id = issued_book_setup['book1_id']
        resp = api.post(f'/api/library/books/{book_id}/issue/', {
            'book': book_id,
            'borrower_type': 'STUDENT',
            'student': student.id,
            'due_date': str(date.today() + timedelta(days=14)),
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
