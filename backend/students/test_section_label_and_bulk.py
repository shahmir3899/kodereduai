"""Students list names the section ("Class 1 - A"), and bulk upload can target one.

Both sections of a class share one master class and one display_name, so a list that
printed display_name alone showed "Class 1" for everyone, and a bulk upload keyed by
master class could not tell two students with the same roll apart.
"""
import pytest

from academic_sessions.models import StudentEnrollment
from students.models import Student

URL = '/api/students/'


def rows(api, ctx, **params):
    query = '&'.join(f'{k}={v}' for k, v in {'page_size': 9999, **params}.items())
    resp = api.get(f'{URL}?{query}', ctx['tokens']['admin'], ctx['SID_A'])
    assert resp.status_code == 200, resp.content
    body = resp.json()
    return {r['id']: r for r in (body['results'] if isinstance(body, dict) else body)}


@pytest.mark.django_db
class TestSectionLabel:
    def test_list_for_a_year_names_the_section(self, api, seed_data, seed_sections):
        by_id = rows(api, seed_data, academic_year=seed_data['academic_year'].id)
        a, b = seed_sections['a_students'][0], seed_sections['b_students'][0]
        master = seed_sections['master'].name
        assert by_id[a.id]['class_name'] == f'{master} - A'
        assert by_id[b.id]['class_name'] == f'{master} - B'

    def test_list_without_a_year_names_the_section_too(self, api, seed_data, seed_sections):
        by_id = rows(api, seed_data)
        a = seed_sections['a_students'][0]
        assert by_id[a.id]['class_name'] == f"{seed_sections['master'].name} - A"

    def test_a_section_without_a_letter_keeps_the_plain_name(self, api, seed_data, seed_sections):
        section = seed_sections['section_a']
        section.section = ''
        section.save(update_fields=['section'])
        a = seed_sections['a_students'][0]
        by_id = rows(api, seed_data, academic_year=seed_data['academic_year'].id)
        assert by_id[a.id]['class_name'] == section.display_name

    def test_a_student_with_no_section_falls_back_to_the_master_class(self, api, seed_data, seed_sections):
        StudentEnrollment.objects.filter(student=seed_sections['a_students'][0]).update(session_class=None)
        a = seed_sections['a_students'][0]
        by_id = rows(api, seed_data, academic_year=seed_data['academic_year'].id)
        assert by_id[a.id]['class_name'] == seed_sections['master'].name


@pytest.mark.django_db
class TestBulkCreateIntoSection:
    def post(self, api, ctx, **body):
        return api.post('/api/students/bulk_create/', {'school_id': ctx['school_a'].id, **body},
                        ctx['tokens']['admin'], ctx['SID_A'])

    def test_creates_the_student_in_the_named_section(self, api, seed_data, seed_sections):
        resp = self.post(
            api, seed_data, class_id=seed_sections['master'].id,
            session_class_id=seed_sections['section_b'].id,
            students=[{'roll_number': 'ZZ1', 'name': 'Bulk Newcomer'}],
        )
        assert resp.status_code == 201, resp.content
        enrollment = StudentEnrollment.objects.get(student__name='Bulk Newcomer')
        assert enrollment.session_class_id == seed_sections['section_b'].id

    def test_updates_the_student_in_that_section_when_rolls_repeat(self, api, seed_data, seed_sections):
        in_a, in_b = seed_sections['a_students'][0], seed_sections['b_students'][0]
        shared = in_a.roll_number
        StudentEnrollment.objects.filter(student=in_b).update(roll_number=shared)
        resp = self.post(
            api, seed_data, class_id=seed_sections['master'].id,
            session_class_id=seed_sections['section_b'].id,
            students=[{'roll_number': shared, 'name': 'Renamed In B'}],
        )
        assert resp.status_code == 201, resp.content
        assert resp.json()['updated_count'] == 1
        assert Student.objects.get(pk=in_b.pk).name == 'Renamed In B'
        assert Student.objects.get(pk=in_a.pk).name != 'Renamed In B'

    def test_rejects_a_section_of_another_class(self, api, seed_data, seed_sections):
        other_class = seed_data['classes'][1]
        resp = self.post(
            api, seed_data, class_id=other_class.id,
            session_class_id=seed_sections['section_a'].id,
            students=[{'roll_number': 'Q1', 'name': 'Wrong Section'}],
        )
        assert resp.status_code == 400
        assert 'session_class_id' in resp.json()

    def test_without_a_section_it_behaves_as_before(self, api, seed_data, seed_sections):
        resp = self.post(
            api, seed_data, class_id=seed_data['classes'][1].id,
            students=[{'roll_number': 'Q2', 'name': 'Plain Upload'}],
        )
        assert resp.status_code == 201, resp.content
        assert resp.json()['created_count'] == 1
