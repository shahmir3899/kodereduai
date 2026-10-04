"""Academics tab (exam_results) and the single "exam average": the last exam's percentage.

One exam is enough to score a student; the old raw-marks average, and the endpoint that
always returned [] (it sorted on a field Exam does not have), are covered here.
"""
from datetime import date, timedelta

import pytest

from academic_sessions.models import StudentEnrollment, Term
from academic_sessions.student_risk_score_service import StudentRiskScoreService
from academics.models import Subject
from examinations.academic_risk_service import AcademicRiskService
from examinations.models import Exam, ExamSubject, ExamType, GradeScale, StudentMark


@pytest.fixture
def ctx(seed_data):
    student = seed_data['students'][0]
    StudentEnrollment.objects.get_or_create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], student=student,
        defaults={'class_obj': seed_data['classes'][0], 'roll_number': student.roll_number},
    )
    subject = Subject.objects.filter(school=seed_data['school_a']).first()
    exam_type = ExamType.objects.create(school=seed_data['school_a'], name='PYTEST_Type')
    term = Term.objects.get(school=seed_data['school_a'], academic_year=seed_data['academic_year'], order=1)
    return {**seed_data, 'student': student, 'subject': subject, 'exam_type': exam_type, 'term': term}


def add_exam(ctx, name, days_ago, marks, total=100, absent=False):
    exam = Exam.objects.create(
        school=ctx['school_a'], academic_year=ctx['academic_year'], term=ctx['term'],
        exam_type=ctx['exam_type'], class_obj=ctx['student'].class_obj, name=name,
        start_date=date.today() - timedelta(days=days_ago), status='COMPLETED',
    )
    es = ExamSubject.objects.create(school=ctx['school_a'], exam=exam, subject=ctx['subject'],
                                    total_marks=total, passing_marks=total * 0.4)
    StudentMark.objects.create(school=ctx['school_a'], exam_subject=es, student=ctx['student'],
                               marks_obtained=None if absent else marks, is_absent=absent)
    return exam


def results(api, ctx):
    return api.get(f"/api/students/{ctx['student'].id}/exam_results/", ctx['tokens']['admin'], ctx['SID_A'])


def summary(api, ctx):
    return api.get(f"/api/students/{ctx['student'].id}/profile_summary/", ctx['tokens']['admin'], ctx['SID_A']).json()


@pytest.mark.django_db
class TestExamResultsEndpoint:
    def test_it_lists_the_exams_newest_first_instead_of_an_empty_list(self, api, ctx):
        add_exam(ctx, 'Old', 60, 50); add_exam(ctx, 'New', 5, 80)
        resp = results(api, ctx)
        assert resp.status_code == 200
        assert [e['exam_name'] for e in resp.json()] == ['New', 'Old']

    def test_each_subject_has_percentage_grade_and_the_exam_has_an_average(self, api, ctx):
        GradeScale.objects.create(school=ctx['school_a'], grade_label='B', min_percentage=60, max_percentage=79.99)
        add_exam(ctx, 'Mid', 5, 150, total=200)
        exam = results(api, ctx).json()[0]
        subject = exam['subjects'][0]
        assert (subject['percentage'], subject['grade']) == (75.0, 'B')
        assert exam['average_percentage'] == 75.0 and exam['exam_date']

    def test_an_absent_subject_is_marked_and_left_out_of_the_average(self, api, ctx):
        add_exam(ctx, 'Mid', 5, 0, absent=True)
        exam = results(api, ctx).json()[0]
        assert exam['subjects'][0]['is_absent'] is True and exam['average_percentage'] is None

    def test_a_student_with_no_exams_gets_an_empty_list(self, api, ctx):
        assert results(api, ctx).json() == []

    def test_two_exams_with_the_same_name_stay_separate(self, api, ctx):
        add_exam(ctx, 'Quiz', 30, 50); add_exam(ctx, 'Quiz', 5, 90)
        assert len(results(api, ctx).json()) == 2


@pytest.mark.django_db
class TestOneExamIsEnough:
    def _entry(self, ctx):
        report = AcademicRiskService(ctx['SID_A'], ctx['academic_year'].id).get_at_risk_students(
            only_student_ids=[ctx['student'].id], include_unflagged=True)
        return report['students'][0]

    def test_a_single_exam_is_scored(self, ctx):
        add_exam(ctx, 'Mid', 5, 80)
        entry = self._entry(ctx)
        assert entry['insufficient_data'] is False and entry['current_average'] == 80.0
        assert entry['trend'] == 'stable' and entry['exams_recorded'] == 1
        assert entry['current_exam_name'] == 'Mid'

    def test_a_single_failing_exam_is_flagged(self, ctx):
        add_exam(ctx, 'Mid', 5, 20)
        assert self._entry(ctx)['severity'] in ('HIGH', 'MEDIUM')

    def test_a_student_with_no_exam_is_still_not_enough_data(self, ctx):
        assert self._entry(ctx)['insufficient_data'] is True

    def test_the_profile_and_the_risk_page_agree_for_a_one_exam_student(self, ctx):
        add_exam(ctx, 'Mid', 5, 20)
        page = next((s for s in StudentRiskScoreService(ctx['SID_A'], ctx['academic_year'].id)
                     .get_student_risk_scores()['students'] if s['student_id'] == ctx['student'].id), None)
        profile = StudentRiskScoreService(ctx['SID_A'], ctx['academic_year'].id).score_student(ctx['student'].id)
        assert page and (page['composite_score'], page['severity']) == (profile['composite_score'], profile['severity'])


@pytest.mark.django_db
class TestExamAverageChip:
    def test_it_is_the_last_exam_percentage_not_a_raw_marks_average(self, api, ctx):
        add_exam(ctx, 'Old', 60, 30, total=50)       # 60%
        add_exam(ctx, 'Mid', 5, 150, total=200)      # 75%  <- the last exam
        body = summary(api, ctx)
        assert body['exam_average'] == 75.0 and body['exam_average_label'] == 'Mid'

    def test_a_real_zero_is_shown_as_zero_not_missing(self, api, ctx):
        add_exam(ctx, 'Mid', 5, 0)
        assert summary(api, ctx)['exam_average'] == 0.0

    def test_no_exams_gives_none(self, api, ctx):
        body = summary(api, ctx)
        assert body['exam_average'] is None and body['exam_average_label'] is None

    def test_the_chip_matches_the_ai_assessment(self, api, ctx):
        add_exam(ctx, 'Mid', 5, 64)
        ai = api.get(f"/api/students/{ctx['student'].id}/ai-profile/", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert summary(api, ctx)['exam_average'] == ai['academic']['avg_score'] == 64.0
