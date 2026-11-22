"""Homework and diary: target per class-subject per week, capped at the target."""
import pytest

from academics.models import ClassSubject
from lms.models import Assignment

from .conftest import MON, TUE, at, measure, stamp

pytestmark = pytest.mark.django_db


@pytest.fixture
def subject_teacher(perf):
    t = perf['staff'][0]
    ClassSubject.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
        subject=perf['subjects'][0], teacher=t,
    )
    return t


def post(perf, t, made, status='PUBLISHED', class_obj=None):
    a = Assignment.objects.create(
        school=perf['school_a'], class_obj=class_obj or perf['classes'][0], subject=perf['subjects'][0],
        teacher=t, title='hw', description='d', status=status,
    )
    stamp(a, created_at=made)


def test_target_is_capped(perf, subject_teacher):
    for _ in range(3):
        post(perf, subject_teacher, at(MON))
    m = measure(perf, 'homework')[subject_teacher.id]
    assert m['due'] == 2          # 6 working days = 1 week x 2
    assert m['done'] == 2
    assert m['score'] == 100


def test_drafts_and_other_classes_do_not_count(perf, subject_teacher):
    post(perf, subject_teacher, at(MON))
    post(perf, subject_teacher, at(TUE), status='DRAFT')
    post(perf, subject_teacher, at(TUE), class_obj=perf['classes'][2])  # not their class-subject
    assert measure(perf, 'homework')[subject_teacher.id]['score'] == 50


def test_no_subjects_means_not_applicable(perf, subject_teacher):
    assert measure(perf, 'homework')[perf['staff'][1].id]['applicable'] is False
