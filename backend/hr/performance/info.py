"""
Figures shown with the report for information only. They never change the score (decision 3: student
results do not count; the others are context an appraiser may want).

    syllabus_on_schedule  topics planned in the period for the teacher's class-subjects, and how many
                          were taught (lms.coverage's definition) by their planned date
    questions_added       question-bank questions the teacher wrote in the period
    class_result_average  average percentage in exams held in the period, for the teacher's class-subjects
    leave_days            approved leave on working days in the period

Same rules as metrics.py: whole-school grouped queries, no per-teacher queries.
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Count, ExpressionWrapper, F, FloatField, Min, Q, Sum
from django.db.models.functions import Coalesce, TruncDate

from .metrics import ctx_teaching_load


def _syllabus(ctx):
    """{(class_id, subject_id): [planned, taught_on_time]}"""
    from lms.models import TopicSchedule

    out = defaultdict(lambda: [0, 0])
    if not ctx.year_ids:
        return out
    taught = Q(
        topic__lesson_plans__is_active=True,
        topic__lesson_plans__status='PUBLISHED',
        topic__lesson_plans__academic_year_id=F('academic_year_id'),
    )
    for row in (
        TopicSchedule.objects.filter(
            academic_year_id__in=ctx.year_ids,
            planned_date__range=(ctx.start, ctx.eff_end),
            topic__chapter__book__school_id=ctx.school_id,
        )
        .values('id', 'planned_date', 'topic__chapter__book__class_obj_id', 'topic__chapter__book__subject_id')
        .annotate(first_taught=Min('topic__lesson_plans__lesson_date', filter=taught))
        .order_by()
    ):
        key = (row['topic__chapter__book__class_obj_id'], row['topic__chapter__book__subject_id'])
        out[key][0] += 1
        if row['first_taught'] and row['first_taught'] <= row['planned_date']:
            out[key][1] += 1
    return out


def _results(ctx):
    """{(class_id, subject_id): [sum of percentages, marks counted]} for exams held in the period."""
    from examinations.models import StudentMark

    out = defaultdict(lambda: [0.0, 0])
    if ctx.eff_end < ctx.start:
        return out
    for row in (
        StudentMark.objects.filter(
            school_id=ctx.school_id, is_absent=False, marks_obtained__isnull=False,
            exam_subject__is_active=True, exam_subject__exam__is_active=True, exam_subject__total_marks__gt=0,
        )
        .annotate(held=Coalesce('exam_subject__exam_date', 'exam_subject__exam__start_date'))
        .filter(held__range=(ctx.start, ctx.eff_end))
        .values('exam_subject__exam__class_obj_id', 'exam_subject__subject_id')
        .annotate(
            pct=Sum(ExpressionWrapper(
                F('marks_obtained') * 100 / F('exam_subject__total_marks'), output_field=FloatField(),
            )),
            n=Count('id'),
        )
        .order_by()
    ):
        key = (row['exam_subject__exam__class_obj_id'], row['exam_subject__subject_id'])
        out[key][0] += float(row['pct'] or 0)
        out[key][1] += row['n']
    return out


def _questions(ctx):
    from examinations.models import Question

    return dict(
        Question.objects.filter(
            school_id=ctx.school_id, created_by_id__in=list(ctx.user_to_staff), is_active=True,
            created_at__gte=ctx.day_start(ctx.start), created_at__lt=ctx.day_start(ctx.eff_end + timedelta(days=1)),
        ).values('created_by_id').annotate(n=Count('id')).values_list('created_by_id', 'n').order_by()
    )


def compute_info(ctx):
    """{staff_id: {...}} for every scored teacher."""
    load, _ = ctx_teaching_load(ctx)
    syllabus = _syllabus(ctx)
    results = _results(ctx)
    questions = _questions(ctx)
    working = set(ctx.calendar.staff_working_days(ctx.start, ctx.eff_end)) if ctx.eff_end >= ctx.start else set()

    out = {}
    for staff_id, t in ctx.teachers.items():
        pairs = load.get(staff_id, {})
        planned = sum(syllabus[p][0] for p in pairs if p in syllabus)
        on_time = sum(syllabus[p][1] for p in pairs if p in syllabus)
        pct_sum = sum(results[p][0] for p in pairs if p in results)
        n_marks = sum(results[p][1] for p in pairs if p in results)
        out[staff_id] = {
            'syllabus_on_schedule': {'planned': planned, 'taught_on_time': on_time},
            'questions_added': questions.get(t['user_id'], 0),
            'class_result_average': round(pct_sum / n_marks, 1) if n_marks else None,
            'marks_counted': n_marks,
            'leave_days': len(ctx.leave.get(staff_id, set()) & working),
        }
    return out
