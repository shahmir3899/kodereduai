"""Question papers: target per class-subject per month, pro-rated; READY / PUBLISHED count."""
from datetime import date

import pytest

from academics.models import ClassSubject
from examinations.models import ExamPaper

from .conftest import at, measure, stamp

pytestmark = pytest.mark.django_db

NOV = (date(2025, 11, 1), date(2025, 11, 30))  # 25 working days


@pytest.fixture
def subject_teacher(perf):
    t = perf['staff'][0]
    ClassSubject.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
        subject=perf['subjects'][0], teacher=t,
    )
    return t


def paper(perf, t, status):
    p = ExamPaper.objects.create(
        school=perf['school_a'], class_obj=perf['classes'][0], subject=perf['subjects'][0],
        paper_title='p', status=status, generated_by=t.user,
    )
    stamp(p, created_at=at(date(2025, 11, 10)))


def test_ready_paper_meets_the_pro_rated_target(perf, subject_teacher):
    paper(perf, subject_teacher, 'READY')
    paper(perf, subject_teacher, 'PUBLISHED')   # beyond the target: capped
    m = measure(perf, 'question_papers', *NOV)[subject_teacher.id]
    assert m['due'] == pytest.approx(25 / 26, abs=0.05)
    assert m['score'] == 100


def test_draft_does_not_count(perf, subject_teacher):
    paper(perf, subject_teacher, 'DRAFT')
    assert measure(perf, 'question_papers', *NOV)[subject_teacher.id]['score'] == 0
