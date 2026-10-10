"""Readers for a student's whole history (every branch, via students.timeline).

One place for what the profile tabs, the parent and student portals and the report show,
so a transferred student's old and new records are always merged the same way. Each row
carries ``branch`` (the earlier branch's name, None for the current branch) and
``read_only`` so the UI can tag old rows and offer no edit actions on them.

Nothing here writes; nothing is copied. Earlier branches' rows are read in place.
"""
from collections import defaultdict

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth

from . import timeline

RATING_FIELDS = (
    'listening', 'speaking', 'writing', 'reading', 'participation', 'confidence', 'social_skills',
    'discipline', 'respect', 'teamwork', 'class_participation', 'responsibility',
)


def _tagged(row, segments, student_id, school_id):
    tag = timeline.branch_tag(segments, student_id, school_id)
    row['branch'] = tag
    row['read_only'] = tag is not None
    return row


def segments_for(student):
    return timeline.student_timeline(student)


# ── Attendance ───────────────────────────────────────────────────────────────

def attendance_records(student, segments=None):
    from attendance.models import AttendanceRecord

    segments = segments or segments_for(student)
    return AttendanceRecord.objects.filter(timeline.attendance_q(segments))


def attendance_totals(student, segments=None):
    """Counts over the whole timeline. Leave days count as present, the same rule as the
    risk assessment, so the Attendance card and the risk card never disagree."""
    totals = attendance_records(student, segments).aggregate(
        total=Count('id'),
        present=Count('id', filter=Q(status='PRESENT')),
        absent=Count('id', filter=Q(status='ABSENT')),
        leave=Count('id', filter=Q(status='LEAVE')),
    )
    present_with_leave = totals['present'] + totals['leave']
    return {
        'total_days': totals['total'],
        'present_days': present_with_leave,
        'absent': totals['absent'],
        'leave': totals['leave'],
        'rate': round(present_with_leave / totals['total'] * 100, 1) if totals['total'] else 0.0,
    }


def attendance_months(student, segments=None):
    """Month rows, newest first. A month spanning a transfer has one row per branch."""
    segments = segments or segments_for(student)
    rows = (
        attendance_records(student, segments)
        .annotate(month=TruncMonth('date'))
        .values('month', 'student_id', 'school_id')
        .annotate(
            present=Count('id', filter=Q(status='PRESENT')),
            absent=Count('id', filter=Q(status='ABSENT')),
            late=Count('id', filter=Q(status='LATE')),
            leave=Count('id', filter=Q(status='LEAVE')),
            total=Count('id'),
        )
    )
    order = {(s.student_id, s.school_id): i for i, s in enumerate(segments)}
    months = []
    for r in sorted(rows, key=lambda r: (r['month'], order.get((r['student_id'], r['school_id']), 0)), reverse=True):
        rate = round((r['present'] + r['leave']) / r['total'] * 100, 1) if r['total'] else 0.0
        months.append(_tagged({
            'month': r['month'].strftime('%B %Y') if r['month'] else None,
            'present': r['present'], 'absent': r['absent'], 'late': r['late'],
            'leave': r['leave'], 'total': r['total'], 'rate': rate,
        }, segments, r['student_id'], r['school_id']))
    return months


# ── Fees ─────────────────────────────────────────────────────────────────────

def fee_payments(student, segments=None):
    from finance.models import FeePayment

    segments = segments or segments_for(student)
    return (
        FeePayment.objects.filter(timeline.fees_q(segments))
        .select_related('monthly_category', 'annual_category')
        .order_by('-year', '-month', '-id')
    )


def fee_rows(student, segments=None):
    """Both ledgers, newest first, each row tagged. ``handed_over`` marks an old row whose
    balance moved to the new branch; ``carried`` marks the new branch's row that took it."""
    from finance.serializers import FeePaymentSerializer

    segments = segments or segments_for(student)
    payments = list(fee_payments(student, segments))
    data = FeePaymentSerializer(payments, many=True).data
    rows = []
    for payment, row in zip(payments, data):
        row = dict(row)
        row['handed_over'] = bool(payment.handed_over_to_exit_id)
        row['carried'] = bool(payment.carried_from_exit_id)
        rows.append(_tagged(row, segments, payment.student_id, payment.school_id))
    return rows


# ── Exams ────────────────────────────────────────────────────────────────────

def exam_marks(student, segments=None, published_only=False):
    """Marks across every branch. ``published_only`` is for parents and students, who must
    only see published results."""
    from examinations.models import Exam, StudentMark

    segments = segments or segments_for(student)
    marks = StudentMark.objects.filter(timeline.marks_q(segments), exam_subject__is_active=True)
    if published_only:
        marks = marks.filter(exam_subject__exam__status=Exam.Status.PUBLISHED)
    return (
        marks
        .select_related('exam_subject', 'exam_subject__exam', 'exam_subject__exam__exam_type', 'exam_subject__subject')
        .order_by('-exam_subject__exam__start_date', 'exam_subject__exam_id', 'exam_subject__subject__name')
    )


def attendance_rows(student, segments=None, *, month=None, year=None, limit=None):
    """Individual attendance records across every branch, newest first, each tagged."""
    segments = segments or segments_for(student)
    qs = attendance_records(student, segments).order_by('-date', '-id')
    if month and year:
        qs = qs.filter(date__month=int(month), date__year=int(year))
    elif month:
        qs = qs.filter(date__month=int(month))
    elif year:
        qs = qs.filter(date__year=int(year))
    if limit:
        qs = qs[:limit]
    return [
        _tagged({
            'id': r.id, 'date': str(r.date), 'status': r.status, 'source': r.source, 'created_at': r.created_at,
        }, segments, r.student_id, r.school_id)
        for r in qs
    ]


def latest_exam(student, segments=None, published_only=True):
    """The most recent mark across every branch, as the parent Overview shows it."""
    segments = segments or segments_for(student)
    mark = exam_marks(student, segments, published_only).first()
    if mark is None:
        return None
    return _tagged({
        'exam_name': mark.exam_subject.exam.name,
        'subject': mark.exam_subject.subject.name,
        'marks_obtained': float(mark.marks_obtained) if mark.marks_obtained is not None else None,
        'total_marks': float(mark.exam_subject.total_marks) if mark.exam_subject.total_marks else None,
    }, segments, mark.student_id, mark.school_id)


def portal_exam_results(student, segments=None):
    """Published results for the parent and student portals: grouped by exam (not by name,
    so two exams that share a name stay separate), newest first, earlier branches tagged."""
    segments = segments or segments_for(student)
    result = {}
    for mark in exam_marks(student, segments, published_only=True):
        exam = mark.exam_subject.exam
        entry = result.get(exam.id)
        if entry is None:
            entry = _tagged({
                'exam_id': exam.id,
                'exam_name': exam.name,
                'exam_type': exam.exam_type.name if exam.exam_type_id else None,
                'exam_date': exam.start_date.isoformat() if exam.start_date else None,
                'subjects': [],
            }, segments, mark.student_id, mark.school_id)
            result[exam.id] = entry
        entry['subjects'].append({
            'subject': mark.exam_subject.subject.name,
            'marks_obtained': float(mark.marks_obtained) if mark.marks_obtained is not None else None,
            'total_marks': float(mark.exam_subject.total_marks) if mark.exam_subject.total_marks else None,
            'is_absent': mark.is_absent,
            'remarks': mark.remarks,
        })
    return list(result.values())


def exam_groups(student, segments=None):
    """Marks grouped by exam, newest first. Grades come from each exam's own school scale."""
    from examinations.models import GradeScale

    segments = segments or segments_for(student)
    scales = defaultdict(list)
    for scale in GradeScale.objects.filter(school_id__in={s.school_id for s in segments}):
        scales[scale.school_id].append(scale)

    result = {}
    for mark in exam_marks(student, segments):
        exam = mark.exam_subject.exam
        entry = result.get(exam.id)
        if entry is None:
            entry = _tagged({
                'exam_id': exam.id,
                'exam_name': exam.name,
                'exam_date': exam.start_date.isoformat() if exam.start_date else None,
                'subjects': [],
            }, segments, mark.student_id, mark.school_id)
            result[exam.id] = entry
        pct = mark.percentage
        entry['subjects'].append({
            'subject': mark.exam_subject.subject.name,
            'marks_obtained': float(mark.marks_obtained) if mark.marks_obtained is not None else None,
            'total_marks': float(mark.exam_subject.total_marks) if mark.exam_subject.total_marks else None,
            'percentage': round(pct, 1) if pct is not None else None,
            'grade': GradeScale.grade_for(pct, scales[mark.school_id]) if pct is not None else None,
            'is_absent': mark.is_absent,
        })
    for entry in result.values():
        pcts = [s['percentage'] for s in entry['subjects'] if s['percentage'] is not None]
        entry['average_percentage'] = round(sum(pcts) / len(pcts), 1) if pcts else None
    return list(result.values())


# ── Enrollments, documents, assessments ──────────────────────────────────────

def enrollment_rows(student, segments=None):
    from academic_sessions.models import StudentEnrollment

    segments = segments or segments_for(student)
    enrollments = (
        StudentEnrollment.objects.filter(timeline.enrollments_q(segments))
        .select_related('academic_year', 'session_class', 'class_obj')
        .prefetch_related('placements__session_class', 'placements__class_obj')
        .order_by('-academic_year__start_date', '-academic_year__id', '-id')
    )
    rows = []
    for e in enrollments:
        placements = sorted(e.placements.all(), key=lambda p: p.start_date)
        class_name = (
            (e.session_class.display_name if e.session_class_id else None)
            or (e.class_obj.name if e.class_obj_id else None)
        )
        section = (
            (e.session_class.section if e.session_class_id else None)
            or (e.class_obj.section if e.class_obj_id else None)
        )
        rows.append(_tagged({
            'academic_year': str(e.academic_year),
            'academic_year_name': getattr(e.academic_year, 'name', str(e.academic_year)),
            'class_name': class_name,
            'section': section,
            'roll_number': e.roll_number,
            'status': e.status,
            'is_active': e.is_active,
            'left_date': e.left_date.isoformat() if e.left_date else None,
            # Only a year with a mid-year move has more than one: class and roll by dates.
            'placements': [
                {
                    'class_name': (
                        (p.session_class.display_name if p.session_class_id else None)
                        or (p.class_obj.name if p.class_obj_id else None)
                    ),
                    'roll_number': p.roll_number,
                    'start_date': p.start_date.isoformat(),
                    'end_date': p.end_date.isoformat() if p.end_date else None,
                    'reason': p.reason,
                }
                for p in placements
            ] if len(placements) > 1 else [],
        }, segments, e.student_id, e.school_id))
    return rows


def document_rows(student, segments=None):
    from .models import StudentDocument
    from .serializers import StudentDocumentSerializer

    segments = segments or segments_for(student)
    docs = list(StudentDocument.objects.filter(timeline.documents_q(segments)).order_by('-created_at'))
    return [
        _tagged(dict(row), segments, doc.student_id, doc.school_id)
        for doc, row in zip(docs, StudentDocumentSerializer(docs, many=True).data)
    ]


def earlier_assessments(student, segments=None):
    """Skills/behaviour ratings and remarks recorded at EARLIER branches, newest first.
    Read-only: the current branch's own assessment stays editable on the Assessment tab."""
    from examinations.models import StudentTermAssessment

    segments = segments or segments_for(student)
    earlier = [s for s in segments if not s.is_current]
    if not earlier:
        return []
    rows = (
        StudentTermAssessment.objects.filter(timeline.rows_q(earlier))
        .select_related('academic_year')
        .order_by('-academic_year__start_date', '-month')
    )
    return [
        _tagged({
            'id': a.id,
            'academic_year_name': a.academic_year.name,
            'month': a.month,
            'ratings': {field: getattr(a, field) for field in RATING_FIELDS},
            'teacher_remark': a.teacher_remark,
            'principal_remark': a.principal_remark,
        }, segments, a.student_id, a.school_id)
        for a in rows
    ]
