"""
Phase 13 — Library Module Tests
================================
Covers: BookCategory CRUD, Book CRUD + search + issue, BookIssue + return,
        LibraryConfig, LibraryStats, permissions, school isolation.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase13_library.py', encoding='utf-8').read())"
"""

import json
from datetime import date, timedelta
from django.test import Client

# ── Seed data ────────────────────────────────────────────────────────────
exec(open('seed_test_data.py', encoding='utf-8').read())
seed = get_seed_data()
reset_counters()

school_a   = seed['school_a']
school_b   = seed['school_b']
SID_A      = seed['SID_A']
SID_B      = seed['SID_B']
users      = seed['users']
tokens     = seed['tokens']
students   = seed['students']
staff      = seed['staff']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

print("\n" + "=" * 70)
print("  PHASE 13: LIBRARY MODULE TESTS")
print("=" * 70)

from library.models import BookCategory, Book, BookIssue, LibraryConfiguration

P13 = 'P13LIB_'
student_1 = students[0]
staff_1 = staff[0]

# ── Cleanup previous P13 data ────────────────────────────────────────────
BookIssue.objects.filter(school=school_a, book__title__startswith=P13).delete()
Book.objects.filter(school=school_a, title__startswith=P13).delete()
BookCategory.objects.filter(school=school_a, name__startswith=P13).delete()


# ==================================================================
# LEVEL A: BOOK CATEGORIES CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: BOOK CATEGORIES CRUD")
print("=" * 70)

# A1: Create category (Admin)
resp = api_post('/api/library/categories/', {
    'school': SID_A,
    'name': f'{P13}Science',
    'description': 'Science books',
}, token_admin, SID_A)
check("A1  Create category (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
cat_id = resp.json().get('id') if resp.status_code == 201 else None

# A2: Create second category
resp = api_post('/api/library/categories/', {
    'school': SID_A,
    'name': f'{P13}Fiction',
    'description': 'Fiction books',
}, token_admin, SID_A)
check("A2  Create second category", resp.status_code == 201,
      f"status={resp.status_code}")
cat2_id = resp.json().get('id') if resp.status_code == 201 else None

# A3: Duplicate name same school -> 400
resp = api_post('/api/library/categories/', {
    'school': SID_A,
    'name': f'{P13}Science',
}, token_admin, SID_A)
check("A3  Duplicate category name -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# A4: Teacher can't create -> 403
resp = api_post('/api/library/categories/', {
    'school': SID_A,
    'name': f'{P13}Teacher Cat',
}, token_teacher, SID_A)
check("A4  Teacher can't create category -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A5: List categories
resp = api_get('/api/library/categories/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("A5  List categories", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# A6: Teacher CAN read categories
resp = api_get('/api/library/categories/', token_teacher, SID_A)
check("A6  Teacher can read categories", resp.status_code == 200,
      f"status={resp.status_code}")

# A7: School B isolation
resp = api_get('/api/library/categories/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("A7  School B isolation (categories)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL B: BOOKS CRUD + SEARCH
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: BOOKS CRUD + SEARCH")
print("=" * 70)

# B1: Create book (Admin)
resp = api_post('/api/library/books/', {
    'title': f'{P13}Physics 101',
    'author': 'Dr. Khan',
    'isbn': f'{P13}ISBN001',
    'category': cat_id,
    'total_copies': 5,
    'available_copies': 5,
    'shelf_location': 'A1',
}, token_admin, SID_A)
check("B1  Create book (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
book_id = resp.json().get('id') if resp.status_code == 201 else None

# B2: Create second book
resp = api_post('/api/library/books/', {
    'title': f'{P13}Chemistry Basics',
    'author': 'Prof. Ali',
    'isbn': f'{P13}ISBN002',
    'category': cat_id,
    'total_copies': 3,
    'available_copies': 3,
    'shelf_location': 'A2',
}, token_admin, SID_A)
check("B2  Create second book", resp.status_code == 201,
      f"status={resp.status_code}")
book2_id = resp.json().get('id') if resp.status_code == 201 else None

# B3: Teacher can't create book -> 403
resp = api_post('/api/library/books/', {
    'title': f'{P13}Teacher Book',
    'author': 'Teacher',
    'total_copies': 1,
    'available_copies': 1,
}, token_teacher, SID_A)
check("B3  Teacher can't create book -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# B4: List books
resp = api_get('/api/library/books/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("B4  List books", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# B5: Search books
resp = api_get('/api/library/books/search/?q=Physics', token_admin, SID_A)
check("B5  Search books", resp.status_code == 200,
      f"status={resp.status_code}")

# B6: Retrieve single book
if book_id:
    resp = api_get(f'/api/library/books/{book_id}/', token_admin, SID_A)
    check("B6  Retrieve book", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("B6  Retrieve book", False, "no book_id")

# B7: Update book
if book_id:
    resp = api_patch(f'/api/library/books/{book_id}/', {
        'shelf_location': 'B1-Updated',
    }, token_admin, SID_A)
    check("B7  Update book", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("B7  Update book", False, "no book_id")

# B8: School B isolation
resp = api_get('/api/library/books/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("B8  School B isolation (books)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL C: BOOK ISSUE + RETURN
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: BOOK ISSUE + RETURN")
print("=" * 70)

# C1: Issue book to student
if book_id:
    resp = api_post(f'/api/library/books/{book_id}/issue/', {
        'book': book_id,
        'borrower_type': 'STUDENT',
        'student': student_1.id,
        'due_date': str(date.today() + timedelta(days=14)),
    }, token_admin, SID_A)
    check("C1  Issue book to student", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    issue_id = resp.json().get('id') if resp.status_code == 201 else None
else:
    check("C1  Issue book to student", False, "no book_id")
    issue_id = None

# C2: Verify available copies decreased
if book_id:
    resp = api_get(f'/api/library/books/{book_id}/', token_admin, SID_A)
    if resp.status_code == 200:
        avail = resp.json().get('available_copies', -1)
        check("C2  Available copies decreased", avail == 4,
              f"available={avail}")
    else:
        check("C2  Available copies decreased", False, f"status={resp.status_code}")
else:
    check("C2  Available copies decreased", False, "no book_id")

# C3: List issues
resp = api_get('/api/library/issues/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("C3  List issues", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# C4: Return book
if issue_id:
    resp = api_post(f'/api/library/issues/{issue_id}/return_book/', {}, token_admin, SID_A)
    check("C4  Return book", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("C4  Return book", False, "no issue_id")

# C5: Verify available copies restored
if book_id:
    resp = api_get(f'/api/library/books/{book_id}/', token_admin, SID_A)
    if resp.status_code == 200:
        avail = resp.json().get('available_copies', -1)
        check("C5  Available copies restored", avail == 5,
              f"available={avail}")
    else:
        check("C5  Available copies restored", False, f"status={resp.status_code}")
else:
    check("C5  Available copies restored", False, "no book_id")

# C6: Issue book to staff
if book2_id:
    resp = api_post(f'/api/library/books/{book2_id}/issue/', {
        'book': book2_id,
        'borrower_type': 'STAFF',
        'staff': staff_1.id,
        'due_date': str(date.today() + timedelta(days=30)),
    }, token_admin, SID_A)
    check("C6  Issue book to staff", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    issue2_id = resp.json().get('id') if resp.status_code == 201 else None
else:
    check("C6  Issue book to staff", False, "no book2_id")
    issue2_id = None

# C7: Overdue list (should be empty)
resp = api_get('/api/library/issues/overdue/', token_admin, SID_A)
check("C7  Overdue list endpoint", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL D: LIBRARY CONFIG & STATS
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: LIBRARY CONFIG & STATS")
print("=" * 70)

# D1: Get config (auto-creates)
resp = api_get('/api/library/config/', token_admin, SID_A)
check("D1  Get library config", resp.status_code == 200,
      f"status={resp.status_code}")

# D2: Update config
resp = api_patch('/api/library/config/', {
    'max_books_student': 5,
    'loan_period_days': 21,
}, token_admin, SID_A)
check("D2  Update library config", resp.status_code == 200,
      f"status={resp.status_code}")

# D3: Teacher can't update config -> 403
resp = api_patch('/api/library/config/', {
    'max_books_student': 10,
}, token_teacher, SID_A)
check("D3  Teacher can't update config -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# D4: Get stats
resp = api_get('/api/library/stats/', token_admin, SID_A)
check("D4  Get library stats", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    stats = resp.json()
    check("D5  Stats has expected fields",
          'total_books' in stats and 'total_issued' in stats,
          f"keys={list(stats.keys())}")
else:
    check("D5  Stats has expected fields", False, "no stats")


# ==================================================================
# LEVEL E: PERMISSIONS & CROSS-CUTTING
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL E: PERMISSIONS & CROSS-CUTTING")
print("=" * 70)

# E1: Unauthenticated -> 401
resp = _client.get('/api/library/books/')
check("E1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# E2: Invalid token -> 401
resp = _client.get(
    '/api/library/books/',
    HTTP_AUTHORIZATION='Bearer garbage_token',
)
check("E2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# E3: Teacher CAN read books
resp = api_get('/api/library/books/', token_teacher, SID_A)
check("E3  Teacher can read books", resp.status_code == 200,
      f"status={resp.status_code}")

# E4: Teacher can't create issue -> 403
if book_id:
    resp = api_post(f'/api/library/books/{book_id}/issue/', {
        'book': book_id,
        'borrower_type': 'STUDENT',
        'student': student_1.id,
        'due_date': str(date.today() + timedelta(days=14)),
    }, token_teacher, SID_A)
    check("E4  Teacher can't issue book -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("E4  Teacher can't issue book -> 403", False, "no book_id")

# Cleanup staff issue
if issue2_id:
    api_post(f'/api/library/issues/{issue2_id}/return_book/', {}, token_admin, SID_A)


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 13 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED - review output above.")
print()
