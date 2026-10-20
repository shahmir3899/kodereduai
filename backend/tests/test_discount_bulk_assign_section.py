"""Bulk-assigning a discount to one section must not reach its sibling section."""
import pytest

from academic_sessions.models import SessionClass, StudentEnrollment
from finance.models import StudentDiscount

pytestmark = [pytest.mark.django_db]

URL = '/api/finance/student-discounts/bulk_assign/'


@pytest.fixture
def two_sections(seed_data):
    school, year = seed_data['school_a'], seed_data['academic_year']
    master = seed_data['classes'][0]
    sections = [
        SessionClass.objects.create(
            school=school, academic_year=year, class_obj=master, display_name=master.name,
            section=letter, grade_level=master.grade_level, is_active=True)
        for letter in ('A', 'B')
    ]
    a_students, b_students = seed_data['students'][0:2], seed_data['students'][2:4]
    for sc, group in zip(sections, (a_students, b_students)):
        for student in group:
            StudentEnrollment.objects.create(
                school=school, student=student, academic_year=year, class_obj=master,
                session_class=sc, roll_number=student.roll_number, status='ACTIVE', is_active=True)
    return sections, a_students, b_students


def _discount(seed_data, api):
    resp = api.post('/api/finance/discounts/', {
        'name': f"{seed_data['prefix']}SecDisc", 'discount_type': 'PERCENTAGE', 'value': 10,
        'applies_to': 'ALL', 'is_active': True,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 201, resp.content[:200]
    return resp.json()['id']


def test_section_assign_reaches_only_that_section(seed_data, api, two_sections):
    (section_a, section_b), a_students, b_students = two_sections
    discount_id = _discount(seed_data, api)
    resp = api.post(URL, {
        'discount_id': discount_id, 'academic_year_id': seed_data['academic_year'].id,
        'class_id': seed_data['classes'][0].id, 'session_class_id': section_b.id,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 200, resp.content[:300]
    assert resp.json()['created'] == len(b_students)
    got = set(StudentDiscount.objects.filter(discount_id=discount_id).values_list('student_id', flat=True))
    assert got == {s.id for s in b_students}


def test_class_only_assign_still_covers_whole_class(seed_data, api, two_sections):
    _, a_students, b_students = two_sections
    discount_id = _discount(seed_data, api)
    resp = api.post(URL, {
        'discount_id': discount_id, 'academic_year_id': seed_data['academic_year'].id,
        'class_id': seed_data['classes'][0].id,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 200, resp.content[:300]
    assert resp.json()['created'] == len(a_students) + len(b_students)


def test_section_from_other_year_is_rejected(seed_data, api, two_sections):
    from datetime import date
    from academic_sessions.models import AcademicYear
    (section_a, _), _, _ = two_sections
    other = AcademicYear.objects.create(
        school=seed_data['school_a'], name=f"{seed_data['prefix']}2033",
        start_date=date(2033, 4, 1), end_date=date(2034, 3, 31), is_current=False, is_active=True)
    resp = api.post(URL, {
        'discount_id': _discount(seed_data, api), 'academic_year_id': other.id,
        'session_class_id': section_a.id,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 400
