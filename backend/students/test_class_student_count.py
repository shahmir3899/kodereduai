"""Regression test for the N+1 fix on Class.student_count (perf fix #1)."""

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from schools.models import Organization, School
from students.models import Class, Student


def _make_school():
    org = Organization.objects.create(name='ClassCount Test Org', slug='classcount-test-org')
    return School.objects.create(
        organization=org,
        name='ClassCount Test School',
        subdomain='classcount-test-school',
    )


class ClassListStudentCountQueryCountTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.user = get_user_model().objects.create_superuser(
            username='class_count_admin',
            email='class_count_admin@test.com',
            password='test12345',
        )
        cls.classes = []
        for i in range(5):
            class_obj = Class.objects.create(school=cls.school, name=f'Class {i}', grade_level=i)
            for j in range(3):
                Student.objects.create(
                    school=cls.school, class_obj=class_obj, roll_number=str(j), name=f'Student {i}-{j}',
                )
            cls.classes.append(class_obj)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_class_list_query_count_does_not_scale_with_class_count(self):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get('/api/classes/', **self.school_header)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['results']), 5)
        for row in response.data['results']:
            self.assertEqual(row['student_count'], 3)
        baseline_query_count = len(ctx.captured_queries)

        extra_class = Class.objects.create(school=self.school, name='Class Extra', grade_level=99)
        for j in range(3):
            Student.objects.create(
                school=self.school, class_obj=extra_class, roll_number=str(j), name=f'Extra {j}',
            )

        with CaptureQueriesContext(connection) as ctx2:
            response2 = self.client.get('/api/classes/', **self.school_header)
        self.assertEqual(response2.status_code, 200, response2.data)
        self.assertEqual(len(ctx2.captured_queries), baseline_query_count)
