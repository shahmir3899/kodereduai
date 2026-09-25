import io
import logging
import re
from datetime import date
from decimal import Decimal
from core.cache_utils import cached_api
from django.db import IntegrityError, transaction
from django.db.models import Case, Count, IntegerField, OuterRef, Q, Subquery, When
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from pgvector.django import CosineDistance
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.permissions import ADMIN_ROLES, IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin, CanManageStudentAssessments, get_effective_role, get_teacher_combined_scope
from core.class_scope import resolve_class_scope
from core.ai_jobs import complete_ai_job, create_ai_job, fail_ai_job
from core.embeddings import generate_text_embedding
from lms.models import Tag, QuestionTag

from .models import (
    ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale,
    Question, ExamPaper, PaperQuestion, StudentResponse, PaperUpload, PaperFeedback,
    StudentTermAssessment, Worksheet, WorksheetItem, WorksheetUpload, StudentExamComment,
    ReportCardPromotion, ReportCardOverride,
)
from .serializers import (
    ExamTypeSerializer, ExamTypeCreateSerializer,
    ExamSerializer, ExamCreateSerializer,
    BulkTestRequestSerializer,
    ExamSubjectSerializer, ExamSubjectCreateSerializer,
    StudentMarkSerializer, StudentMarkCreateSerializer,
    StudentMarkBulkEntrySerializer,
    StudentResponseSerializer, StudentResponseBulkSubmitSerializer,
    GradeScaleSerializer, GradeScaleCreateSerializer,
    ExamGroupSerializer, ExamGroupCreateSerializer,
    ExamGroupWizardCreateSerializer, DateSheetUpdateSerializer,
    QuestionSerializer, QuestionCreateUpdateSerializer,
    ExamPaperSerializer, ExamPaperCreateUpdateSerializer,
    ExamPaperDraftEnsureSerializer, ExamPaperDraftAutosaveSerializer,
    PaperUploadSerializer, PaperUploadCreateSerializer,
    StudentTermAssessmentSerializer,
    PaperFeedbackSerializer, QuestionReviewSerializer,
    WorksheetSerializer, WorksheetDraftEnsureSerializer, WorksheetDraftAutosaveSerializer,
    WorksheetUploadSerializer, WorksheetUploadCreateSerializer,
)
from .tasks import recompute_question_stats
from .term_periods import attendance_summaries, report_attendance_window as _report_attendance_window

logger = logging.getLogger(__name__)


def _resolve_school_id(request):
    school_id = ensure_tenant_school_id(request)
    if school_id:
        return school_id
    # If X-School-ID header was sent but rejected, don't fall back
    if request.headers.get('X-School-ID'):
        return None
    sid = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if sid:
        return int(sid)
    if request.user.school_id:
        return request.user.school_id
    return None


def _annotate_marks_completion(qs):
    """Annotate an Exam queryset with `enrolled_count` and `marks_entered_count`,
    used by ExamSerializer to compute marks_entry_complete (gates Announce Results).

    Both use correlated Subqueries rather than joined Count()s: the queryset already
    carries a `subjects_count = Count('exam_subjects', ...)` annotation (see
    ExamViewSet.get_queryset / ExamGroupViewSet's exams_prefetch_qs), and stacking a
    second Count() over a different join (exam_subjects -> student_marks) on the same
    query would cross-multiply with that join and inflate both counts.

    - enrolled_count: actively-enrolled students in this exam's (school, class, year).
      Assumes every enrolled student sits every subject of the exam (no per-subject
      roster), matching StudentMarkCreateSerializer._resolve_enrollment's lookup.
    - marks_entered_count: StudentMark rows across this exam's active subjects that
      have a value (marks_obtained set, or explicitly marked absent) -- a row with
      neither means "not entered yet".
    """
    from academic_sessions.models import StudentEnrollment

    class_enrolled = StudentEnrollment.objects.filter(
        school_id=OuterRef('school_id'),
        class_obj_id=OuterRef('class_obj_id'),
        academic_year_id=OuterRef('academic_year_id'),
        is_active=True,
    ).order_by().values('class_obj_id').annotate(c=Count('id')).values('c')
    # A section exam expects marks only from its section's students.
    section_enrolled = StudentEnrollment.objects.filter(
        session_class_id=OuterRef('session_class_id'),
        is_active=True,
    ).order_by().values('session_class_id').annotate(c=Count('id')).values('c')
    enrolled_subquery = Case(
        When(session_class__isnull=True, then=Subquery(class_enrolled[:1], output_field=IntegerField())),
        default=Subquery(section_enrolled[:1], output_field=IntegerField()),
        output_field=IntegerField(),
    )

    entered_subquery = StudentMark.objects.filter(
        exam_subject__exam_id=OuterRef('pk'),
        exam_subject__is_active=True,
    ).filter(
        Q(marks_obtained__isnull=False) | Q(is_absent=True)
    ).order_by().values('exam_subject__exam_id').annotate(c=Count('id')).values('c')

    return qs.annotate(
        enrolled_count=Coalesce(enrolled_subquery, 0),
        marks_entered_count=Coalesce(
            Subquery(entered_subquery[:1], output_field=IntegerField()), 0,
        ),
    )


def _marks_entry_complete(exam):
    """True when every active exam-subject has marks entered (or absence noted)
    for every actively-enrolled student. Requires `exam` to come from a queryset
    that ran through _annotate_marks_completion (plus the `subjects_count`
    annotation) -- see ExamViewSet.get_queryset / ExamGroupViewSet.get_queryset.
    Same formula as ExamSerializer.get_marks_entry_complete; kept here too since
    announce_results/announce_results_all enforce it server-side, not just display it.
    """
    expected = getattr(exam, 'subjects_count', 0) * getattr(exam, 'enrolled_count', 0)
    return expected > 0 and getattr(exam, 'marks_entered_count', 0) >= expected


def _apply_teacher_exam_scope(qs, request, class_field='class_obj_id', subject_field=None):
    """Apply dual-layer teacher scope for exam-related querysets.
    Uses section-class scope when teacher has session assignments."""
    if get_effective_role(request) != 'TEACHER':
        return qs

    school_id = _resolve_school_id(request)
    scope = get_teacher_combined_scope(request, school_id=school_id)
    all_class_ids = scope['all_class_ids']
    full_class_ids = scope['full_class_ids']
    session_ids = scope.get('full_session_class_ids', set())

    # A section-only exam belongs to that section's teachers (class teacher or
    # subject teacher of the section); class-level scope alone let a 2-B
    # teacher see and mark a 2-A exam. Whole-class exams are unaffected.
    from academics.models import ClassSubject

    teacher_sections = set(session_ids) | set(
        ClassSubject.objects.filter(
            school_id=school_id, teacher__user=request.user, is_active=True, session_class__isnull=False,
        ).values_list('session_class_id', flat=True)
    )
    section_field = class_field[:-len('class_obj_id')] + 'session_class'
    qs = qs.filter(
        Q(**{f'{section_field}__isnull': True}) | Q(**{f'{section_field}_id__in': teacher_sections})
    )

    # For class-level entities (Exam), visibility is union of full class scope and subject assignment classes.
    if not subject_field:
        if all_class_ids:
            return qs.filter(**{f'{class_field}__in': all_class_ids})
        return qs.none()

    predicates = Q()

    if session_ids:
        # Section-scoped: teacher's class-teacher assignment is section-level
        # Access exams only for those specific master class IDs
        if full_class_ids:
            predicates |= Q(**{f'{class_field}__in': full_class_ids})
    elif full_class_ids:
        predicates |= Q(**{f'{class_field}__in': full_class_ids})

    for class_id, subject_ids in scope['class_subject_map'].items():
        if subject_ids:
            predicates |= Q(**{class_field: class_id, f'{subject_field}__in': list(subject_ids)})

    if not predicates:
        return qs.none()
    return qs.filter(predicates)


def _get_teacher_class_subject_map(request, school_id=None):
    """Return {class_id: set(subject_ids)} for teacher-assigned subject scope."""
    if get_effective_role(request) != 'TEACHER':
        return {}
    school_id = school_id or _resolve_school_id(request)
    scope = get_teacher_combined_scope(request, school_id=school_id)
    return scope.get('class_subject_map', {})


def _get_teacher_allowed_subject_ids(request, school_id=None):
    """Flatten teacher class-subject assignments into a subject ID set."""
    class_subject_map = _get_teacher_class_subject_map(request, school_id=school_id)
    allowed = set()
    for subject_ids in class_subject_map.values():
        allowed.update(subject_ids)
    return allowed


def _is_teacher_allowed_for_class_subject(request, class_id, subject_id, school_id=None):
    """Check strict teacher assignment for a class-subject pair."""
    if get_effective_role(request) != 'TEACHER':
        return True
    if class_id is None or subject_id is None:
        return False
    class_subject_map = _get_teacher_class_subject_map(request, school_id=school_id)
    try:
        class_id = int(class_id)
        subject_id = int(subject_id)
    except (TypeError, ValueError):
        return False
    return subject_id in class_subject_map.get(class_id, set())


def _is_teacher_class_teacher_for_class(request, class_id, school_id=None):
    """Check whether current teacher has class-teacher scope for this class."""
    if get_effective_role(request) != 'TEACHER':
        return False
    try:
        class_id = int(class_id)
    except (TypeError, ValueError):
        return False
    scope = get_teacher_combined_scope(request, school_id=school_id)
    return class_id in scope.get('full_class_ids', set())


def _assert_can_bulk_generate_comments(request, exam, school_id):
    """Bulk generation touches every subject on the exam, so (unlike per-subject
    edit/regenerate) a subject teacher isn't enough -- only the class teacher or
    an admin role may trigger it."""
    role = get_effective_role(request)
    allowed = role in ADMIN_ROLES or role == 'MANAGER' or (
        role == 'TEACHER'
        and _is_teacher_class_teacher_for_class(request, exam.class_obj_id, school_id=school_id)
    )
    if not allowed:
        raise PermissionDenied('Only admins or the class teacher can generate comments for this exam.')


def _can_manage_exam_scope(request, class_id=None, subject_id=None, school_id=None):
    """Return True when role is allowed to write exam-related data (papers, marks, ...)
    scoped to a given (class, subject) pair.

    A teacher may manage a resource for (class, subject) either as the class's
    class-teacher (homeroom-style, covers every subject taught in that class)
    or as the subject teacher specifically assigned to that class-subject
    pairing -- the same dual-layer scope _apply_teacher_exam_scope already
    grants for read access. Generic across exam papers, marks entry, etc.;
    originally exam-paper-specific (previously only the class-teacher branch
    was checked, so any class-teacher could create/edit/autosave exam papers
    for subjects they don't teach in that class).
    """
    role = get_effective_role(request)
    if role in ADMIN_ROLES or role == 'MANAGER':
        return True
    if role != 'TEACHER':
        return False
    return (
        _is_teacher_class_teacher_for_class(request, class_id, school_id=school_id)
        or _is_teacher_allowed_for_class_subject(request, class_id, subject_id, school_id=school_id)
    )


def _class_roster(school_id, class_obj_id, academic_year_id, as_of_date=None, session_class_id=None):
    """Students to show for a given (class, academic year) -- shared by the exam
    results/class-summary endpoints and the single-student report card's
    classmate stats (rank, class average).

    Scoped via StudentEnrollment, matching the Students/Attendance pages --
    NOT the student's current class_obj/is_active snapshot, which drifts once
    a student is later promoted or graduates (a student who graduated last
    year would otherwise still show up on -- or worse, vanish from -- a card
    from years before that, depending on their current is_active state;
    enrollment is the source of truth for "who was in this class, this year").

    `as_of_date` (typically the exam's own date) applies month-precision for a
    withdrawn/transferred student via enrollment_covers_month(): still included
    for their departure month and every month before, excluded after. Omit it
    to fall back to a plain is_active check (whole-year, no month cutoff) --
    used when there's no meaningful date to anchor to.

    `session_class_id` narrows the roster to one section. Exams are keyed by
    master class, so without it two sections sharing a master class (e.g.
    "Class 2 - A"/"Class 2 - B") were ranked and averaged as one class.

    Falls back to the current class roster when this (class, year) has no
    enrollment rows at all (legacy data predating StudentEnrollment).
    Returns (students, {student_id: that year's roll_number}).
    """
    from students.models import Student
    from academic_sessions.roster import enrollments_in_scope

    enrollment_qs = enrollments_in_scope(
        school_id,
        academic_year_id=academic_year_id,
        session_class_id=session_class_id,
        class_obj_id=class_obj_id,
        year=as_of_date.year if as_of_date else None,
        month=as_of_date.month if as_of_date else None,
    )
    enrollments = list(enrollment_qs.select_related('student')) if enrollment_qs is not None else []

    if enrollments or session_class_id:
        # An empty section is an empty roster: the legacy fallback below is
        # master-class wide and would list every section's students.
        roll_by_student = {e.student_id: e.roll_number for e in enrollments}
        students = sorted((e.student for e in enrollments), key=lambda s: roll_by_student[s.id])
        return students, roll_by_student

    students = list(Student.objects.filter(
        school_id=school_id, class_obj_id=class_obj_id, is_active=True,
    ).order_by('roll_number'))
    return students, {s.id: s.roll_number for s in students}


def _exam_class_subjects(exam):
    """ClassSubject rows that define an exam's subjects.

    A section exam takes its section's subjects. A whole-class exam takes the
    class's subjects for the exam's year (every section's). The auto-fill used
    to filter by class_obj alone, mixing in other years' and, for split classes,
    every section's pairings (CLASS_SYSTEM_GUIDE.md issue 3).
    """
    from academics.models import ClassSubject

    qs = ClassSubject.objects.filter(school_id=exam.school_id, is_active=True).select_related('subject')
    if exam.session_class_id:
        return qs.filter(session_class_id=exam.session_class_id)
    return qs.filter(class_obj_id=exam.class_obj_id).filter(
        Q(academic_year_id=exam.academic_year_id) | Q(academic_year__isnull=True)
    )


def _exam_roster(school_id, exam, session_class_id=None):
    """_class_roster() for an Exam's own (class, academic year), anchored to
    the exam's own date for month-precision withdrawn/transferred handling.
    A section exam is always its section's roster."""
    return _class_roster(
        school_id, exam.class_obj_id, exam.academic_year_id,
        as_of_date=exam.start_date or exam.end_date,
        session_class_id=exam.session_class_id or session_class_id,
    )


def _exam_section_param(request, school_id, exam):
    """Validated `session_class_id` query param for an exam's results, or None.

    Exam has no section of its own yet, so the caller names one; it must be a
    section of this exam's master class in this exam's year.
    """
    if exam.session_class_id:
        return exam.session_class_id
    raw = request.query_params.get('session_class_id')
    if not raw:
        return None
    from academic_sessions.models import SessionClass

    try:
        section_id = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({'session_class_id': 'Must be an integer.'})
    if not SessionClass.objects.filter(
        id=section_id,
        school_id=school_id,
        academic_year_id=exam.academic_year_id,
        class_obj_id=exam.class_obj_id,
    ).exists():
        raise ValidationError({'session_class_id': "Not a section of this exam's class and year."})
    return section_id


def _short_academic_year_name(name):
    return re.sub(r'^academic\s+year\s*', '', name or '', flags=re.IGNORECASE).strip()


def _generate_bulk_test_name(subject_name, term_name=None, academic_year_name=None):
    name = f'Test - {subject_name}'
    if term_name and term_name.lower() not in name.lower():
        name += f' - {term_name}'
    year_short = _short_academic_year_name(academic_year_name)
    if year_short:
        name += f' {year_short}'
    return name


def _assert_bulk_test_role(request):
    role = get_effective_role(request)
    if role not in ADMIN_ROLES and role != 'TEACHER':
        raise PermissionDenied('You do not have permission to manage tests.')


def _build_bulk_test_plan(request, data):
    school_id = _resolve_school_id(request)
    if not school_id:
        raise ValidationError({'detail': 'No school context.'})

    _assert_bulk_test_role(request)

    from academic_sessions.models import AcademicYear, Term
    from academics.models import ClassSubject, Subject
    from students.models import Class

    academic_year = AcademicYear.objects.filter(
        school_id=school_id,
        id=data['academic_year'],
        is_active=True,
    ).only('id', 'name').first()
    if not academic_year:
        raise ValidationError({'academic_year': 'Academic year is invalid for the active school.'})

    term = None
    if data.get('term'):
        term = Term.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year.id,
            id=data['term'],
        ).only('id', 'name').first()
        if not term:
            raise ValidationError({'term': 'Term is invalid for the selected academic year.'})

    exam_type = ExamType.objects.filter(
        school_id=school_id,
        id=data['exam_type'],
        is_active=True,
    ).only('id', 'name').first()
    if not exam_type:
        raise ValidationError({'exam_type': 'Exam type is invalid for the active school.'})

    class_obj = Class.objects.filter(
        school_id=school_id,
        id=data['class_obj'],
        is_active=True,
    ).only('id', 'name').first()
    if not class_obj:
        raise ValidationError({'class_obj': 'Class is invalid for the active school.'})

    role = get_effective_role(request)
    teacher_scope = get_teacher_combined_scope(
        request,
        school_id=school_id,
        academic_year_id=academic_year.id,
    )
    if role == 'TEACHER' and class_obj.id not in teacher_scope['all_class_ids']:
        raise PermissionDenied('You do not have access to this class.')

    requested_subject_ids = [row['subject_id'] for row in data['tests']]
    subjects_by_id = {
        subject.id: subject
        for subject in Subject.objects.filter(
            school_id=school_id,
            id__in=requested_subject_ids,
            is_active=True,
        ).only('id', 'name', 'code')
    }

    class_subjects_qs = ClassSubject.objects.filter(
        school_id=school_id,
        class_obj_id=class_obj.id,
        subject_id__in=requested_subject_ids,
        is_active=True,
    ).filter(
        Q(academic_year_id=academic_year.id) | Q(academic_year__isnull=True)
    ).select_related('subject')

    if role == 'TEACHER':
        class_subjects_qs = class_subjects_qs.filter(teacher__user=request.user)

    assigned_subjects = {}
    for class_subject in class_subjects_qs.order_by('-academic_year_id', '-id'):
        assigned_subjects.setdefault(class_subject.subject_id, class_subject)

    existing_tests_qs = ExamSubject.objects.filter(
        school_id=school_id,
        subject_id__in=requested_subject_ids,
        is_active=True,
        exam__school_id=school_id,
        exam__academic_year_id=academic_year.id,
        exam__class_obj_id=class_obj.id,
        exam__exam_type_id=exam_type.id,
        exam__exam_group__isnull=True,
        exam__is_active=True,
    ).select_related('exam', 'subject')
    if term:
        existing_tests_qs = existing_tests_qs.filter(exam__term_id=term.id)
    else:
        existing_tests_qs = existing_tests_qs.filter(exam__term__isnull=True)

    existing_by_subject = {}
    for exam_subject in existing_tests_qs:
        existing_by_subject.setdefault(exam_subject.subject_id, exam_subject)

    items = []
    for row in data['tests']:
        subject = subjects_by_id.get(row['subject_id'])
        class_subject = assigned_subjects.get(row['subject_id'])
        existing_exam_subject = existing_by_subject.get(row['subject_id'])

        if not subject:
            items.append({
                'subject_id': row['subject_id'],
                'subject_name': None,
                'subject_code': None,
                'name': row.get('name', '').strip(),
                'exam_date': row['exam_date'],
                'total_marks': row['total_marks'],
                'start_time': row.get('start_time'),
                'end_time': row.get('end_time'),
                'status': 'invalid',
                'reason': 'Subject is invalid for the active school.',
            })
            continue

        resolved_name = row.get('name', '').strip() or _generate_bulk_test_name(
            subject.name,
            term_name=term.name if term else None,
            academic_year_name=academic_year.name,
        )

        if not class_subject:
            reason = 'You are not assigned to this class-subject pair.' if role == 'TEACHER' else 'Subject is not assigned to the selected class.'
            items.append({
                'subject_id': subject.id,
                'subject_name': subject.name,
                'subject_code': subject.code,
                'name': resolved_name,
                'exam_date': row['exam_date'],
                'total_marks': row['total_marks'],
                'start_time': row.get('start_time'),
                'end_time': row.get('end_time'),
                'status': 'forbidden' if role == 'TEACHER' else 'invalid',
                'reason': reason,
            })
            continue

        if existing_exam_subject:
            items.append({
                'subject_id': subject.id,
                'subject_name': subject.name,
                'subject_code': subject.code,
                'name': resolved_name,
                'exam_date': row['exam_date'],
                'total_marks': row['total_marks'],
                'start_time': row.get('start_time'),
                'end_time': row.get('end_time'),
                'status': 'conflict',
                'reason': f'Active test "{existing_exam_subject.exam.name}" already exists for this subject.',
                'existing_exam_id': existing_exam_subject.exam_id,
            })
            continue

        items.append({
            'subject_id': subject.id,
            'subject_name': subject.name,
            'subject_code': subject.code,
            'name': resolved_name,
            'exam_date': row['exam_date'],
            'total_marks': row['total_marks'],
            'start_time': row.get('start_time'),
            'end_time': row.get('end_time'),
            'status': 'create',
            'reason': '',
        })

    counts = {
        'requested': len(items),
        'create': sum(1 for item in items if item['status'] == 'create'),
        'conflict': sum(1 for item in items if item['status'] == 'conflict'),
        'forbidden': sum(1 for item in items if item['status'] == 'forbidden'),
        'invalid': sum(1 for item in items if item['status'] == 'invalid'),
    }

    return {
        'class_obj': class_obj.id,
        'class_name': class_obj.name,
        'academic_year': academic_year.id,
        'academic_year_name': academic_year.name,
        'term': term.id if term else None,
        'term_name': term.name if term else None,
        'exam_type': exam_type.id,
        'exam_type_name': exam_type.name,
        'counts': counts,
        'can_apply': counts['create'] > 0 and counts['conflict'] == 0 and counts['forbidden'] == 0 and counts['invalid'] == 0,
        'tests': items,
    }


class ExamTypeViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = ExamType.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExamTypeCreateSerializer
        return ExamTypeSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        return super().get_queryset()


def _build_date_sheet_grid(group, school_id):
    """Pivot an ExamGroup's per-(class, subject) exam dates into a Date x Class grid.

    Subjects with no exam_date yet can't be placed on a date-indexed grid, so
    they're returned separately as 'unscheduled' rather than silently dropped.
    Two subjects landing on the same date for the same class (not prevented
    anywhere upstream) are joined into one cell rather than treated as an error.
    """
    exam_subjects = ExamSubject.objects.filter(
        exam__exam_group=group, exam__is_active=True,
        is_active=True, school_id=school_id,
    ).select_related('subject', 'exam', 'exam__class_obj').order_by(
        'exam__class_obj__grade_level', 'exam__class_obj__name', 'subject__name',
    )

    columns_by_id = {}
    cells = {}  # (date, class_id) -> [subject_name, ...]
    unscheduled = []

    for es in exam_subjects:
        cls = es.exam.class_obj
        if cls.id not in columns_by_id:
            columns_by_id[cls.id] = {
                'class_id': cls.id,
                'label': f'{cls.name} - {cls.section}' if cls.section else cls.name,
                '_sort_key': (cls.grade_level if cls.grade_level is not None else 0, cls.name),
            }
        if not es.exam_date:
            unscheduled.append({
                'subject_name': es.subject.name,
                'class_name': columns_by_id[cls.id]['label'],
            })
            continue
        cells.setdefault((es.exam_date, cls.id), []).append(es.subject.name)

    columns = sorted(columns_by_id.values(), key=lambda c: c['_sort_key'])
    for col in columns:
        col.pop('_sort_key', None)

    distinct_dates = sorted({exam_date for (exam_date, _class_id) in cells.keys()})
    rows = []
    for exam_date in distinct_dates:
        row_cells = {}
        for col in columns:
            names = cells.get((exam_date, col['class_id']))
            row_cells[col['class_id']] = ' / '.join(names) if names else ''
        rows.append({
            'date': exam_date.isoformat(),
            'day_name': exam_date.strftime('%A'),
            'cells': row_cells,
        })

    unscheduled.sort(key=lambda item: (item['class_name'], item['subject_name']))

    return {
        'columns': columns,
        'rows': rows,
        'unscheduled': unscheduled,
    }


class ExamGroupViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = ExamGroup.objects.all()
    # Read (list/retrieve, date-sheet GET, both date-sheet downloads) open to
    # every authenticated role -- matches ExamViewSet/ExamTypeViewSet. Writes
    # (create/update/delete, date-sheet PATCH, publish/announce/bulk actions,
    # all POST) stay admin-only via the same IsSchoolAdminOrReadOnly check.
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExamGroupCreateSerializer
        return ExamGroupSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        from django.db.models import Prefetch
        qs = super().get_queryset().select_related(
            'school', 'academic_year', 'term', 'exam_type',
        )

        # Support active/inactive/all filter for exam groups
        exam_is_active = self.request.query_params.get('is_active')
        exam_filter = None
        if exam_is_active is not None:
            if exam_is_active.lower() == 'true':
                exam_filter = True
            elif exam_is_active.lower() == 'false':
                exam_filter = False

        exams_prefetch_qs = Exam.objects.select_related(
            'class_obj', 'exam_type', 'academic_year', 'term',
        ).annotate(
            subjects_count=Count('exam_subjects', filter=Q(exam_subjects__is_active=True)),
        )
        exams_prefetch_qs = _annotate_marks_completion(exams_prefetch_qs)
        if exam_filter is not None:
            exams_prefetch_qs = exams_prefetch_qs.filter(is_active=exam_filter)

        qs = qs.prefetch_related(
            Prefetch('exams', queryset=exams_prefetch_qs, to_attr='_prefetched_active_exams'),
        )

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        term = self.request.query_params.get('term')
        if term:
            qs = qs.filter(term_id=term)
        return qs

    def perform_destroy(self, instance):
        # Exam.exam_group is on_delete=SET_NULL (an exam can outlive its group,
        # e.g. after a group merge), so deleting the group alone would silently
        # orphan its per-class Exam rows instead of removing them -- they'd keep
        # blocking the wizard's per-class conflict check forever while no longer
        # being visible anywhere as a group. Explicitly delete them first; Exam
        # cascades (CASCADE) to ExamSubject -> StudentMark on its own.
        instance.exams.all().delete()
        instance.delete()

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        """POST /api/examinations/exam-groups/bulk_delete/  Body: {"ids": [1, 2, 3]}

        Same cascade-safety as perform_destroy above: Exam.exam_group is
        SET_NULL, so the child Exam rows are deleted explicitly rather than
        relying on queryset.delete() to cascade them.
        """
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = self.get_queryset().filter(id__in=ids)
        group_ids = list(queryset.values_list('id', flat=True))
        Exam.objects.filter(exam_group_id__in=group_ids).delete()
        queryset.delete()
        return Response({'requested_count': len(ids), 'deleted_count': len(group_ids)})

    @action(detail=False, methods=['post'], url_path='wizard-create')
    def wizard_create(self, request):
        """Create ExamGroup + per-class Exams + ExamSubjects in one transaction."""
        serializer = ExamGroupWizardCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school context.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.db import transaction
        from academics.models import ClassSubject
        from students.models import Class

        from academic_sessions.models import SessionClass

        # Targets: whole classes (class_ids) and sections (session_class_ids).
        # `key` matches the class_subjects / date_sheet entries the client sent.
        class_ids = data['class_ids']
        valid_classes = list(Class.objects.filter(
            school_id=school_id, id__in=class_ids, is_active=True,
        ))
        if len(valid_classes) != len(class_ids):
            return Response(
                {'detail': 'One or more class IDs are invalid.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        targets = [
            {'key': ('class', cls.id), 'class_obj': cls, 'session_class': None, 'label': cls.name}
            for cls in valid_classes
        ]

        section_ids = data['session_class_ids']
        sections = list(SessionClass.objects.filter(
            school_id=school_id, academic_year_id=data['academic_year'], id__in=section_ids,
            is_active=True, class_obj__isnull=False,
        ).select_related('class_obj'))
        if len(sections) != len(section_ids):
            return Response(
                {'detail': 'One or more sections are invalid for this academic year.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sections_per_class = {
            row['class_obj_id']: row['n']
            for row in SessionClass.objects.filter(
                school_id=school_id, academic_year_id=data['academic_year'], is_active=True,
                class_obj_id__in={sc.class_obj_id for sc in sections},
            ).values('class_obj_id').annotate(n=Count('id'))
        }
        for sc in sections:
            # Only a class split into sections gets section-only exams; the
            # only section of a class gets an ordinary whole-class exam.
            split = sections_per_class.get(sc.class_obj_id, 1) > 1
            targets.append({
                'key': ('section', sc.id), 'class_obj': sc.class_obj,
                'session_class': sc if split else None, 'label': sc.label,
            })

        # Check for conflicts (only active exams block new creation). Scoped to
        # the academic year (not just term) since a master class's id is
        # reused across years -- without this, two unrelated years' exams for
        # the same class/type with a blank term could look like a conflict. A
        # whole-class exam already covers each of its sections.
        conflicts = []
        for target in targets:
            existing = Exam.objects.filter(
                school_id=school_id,
                academic_year_id=data['academic_year'],
                exam_type_id=data['exam_type'],
                class_obj=target['class_obj'],
                term_id=data.get('term'),
                is_active=True,
            )
            if target['session_class'] is not None:
                existing = existing.filter(
                    Q(session_class__isnull=True) | Q(session_class=target['session_class'])
                )
            existing = existing.first()
            if existing:
                conflicts.append({
                    'class_id': target['class_obj'].id,
                    'session_class_id': target['session_class'].id if target['session_class'] else None,
                    'class_name': target['label'],
                    'existing_exam': existing.name,
                })
        if conflicts:
            return Response({
                'detail': 'Some classes already have an active exam of this type for this term.',
                'conflicts': conflicts,
            }, status=status.HTTP_409_CONFLICT)

        # An exam group name is unique per (school, name, academic_year). Reuse
        # an existing group with a matching term/exam_type instead of erroring,
        # so a school can run the wizard multiple times -- once per batch of
        # classes -- under the same exam name (e.g. enrolling more classes into
        # "1st Term Exam 2026-27" later). A same-named group with a different
        # term/exam_type is a genuine naming collision, not a valid reuse.
        existing_group = ExamGroup.objects.filter(
            school_id=school_id,
            name=data['name'],
            academic_year_id=data['academic_year'],
        ).first()
        if existing_group and (
            existing_group.term_id != data.get('term')
            or existing_group.exam_type_id != data['exam_type']
        ):
            return Response({
                'detail': (
                    f'An exam group named "{data["name"]}" already exists for this '
                    'academic year with a different exam type or term. Please choose '
                    'a different name.'
                ),
            }, status=status.HTTP_400_BAD_REQUEST)

        # Build lookup: (class_id, subject_id) -> {exam_date, start_time, end_time}
        date_sheet_list = data.get('date_sheet', [])
        date_sheet_map = {}
        for entry in date_sheet_list:
            subject_id = entry.get('subject_id')
            if entry.get('session_class_id'):
                key = ('section', int(entry['session_class_id']))
            elif entry.get('class_id'):
                key = ('class', int(entry['class_id']))
            else:
                continue
            if subject_id:
                date_sheet_map[(key, int(subject_id))] = {
                    'exam_date': entry.get('exam_date'),
                    'start_time': entry.get('start_time'),
                    'end_time': entry.get('end_time'),
                }

        default_total = data.get('default_total_marks', 100)
        default_passing = data.get('default_passing_marks', 33)

        try:
            with transaction.atomic():
                group = existing_group or ExamGroup.objects.create(
                    school_id=school_id,
                    academic_year_id=data['academic_year'],
                    term_id=data.get('term'),
                    exam_type_id=data['exam_type'],
                    name=data['name'],
                    description=data.get('description', ''),
                    start_date=data.get('start_date'),
                    end_date=data.get('end_date'),
                )

                created_exams = []
                for target in targets:
                    exam = Exam.objects.create(
                        school_id=school_id,
                        academic_year_id=data['academic_year'],
                        term_id=data.get('term'),
                        exam_type_id=data['exam_type'],
                        class_obj=target['class_obj'],
                        session_class=target['session_class'],
                        exam_group=group,
                        name=f"{data['name']} - {target['label']}",
                        start_date=data.get('start_date'),
                        end_date=data.get('end_date'),
                        status=Exam.Status.SCHEDULED,
                    )
                    created_exams.append((target['key'], exam))

                # Per-class/section subject restriction. A target present here is
                # filtered to exactly its listed subject_ids -- including an empty
                # list, which deliberately yields zero ExamSubjects rather than
                # falling back. A target absent entirely (older clients) keeps
                # every subject assigned to it.
                subject_restriction = {}
                for entry in (data.get('class_subjects') or []):
                    if entry.get('session_class_id'):
                        subject_restriction[('section', entry['session_class_id'])] = entry.get('subject_ids') or []
                    elif entry.get('class_id'):
                        subject_restriction[('class', entry['class_id'])] = entry.get('subject_ids') or []

                all_exam_subjects = []
                for key, exam in created_exams:
                    class_subjects = _exam_class_subjects(exam)
                    if key[0] == 'section' and exam.session_class_id is None:
                        # The only section of its class: its own pairings.
                        class_subjects = class_subjects.filter(session_class_id=key[1])
                    if key in subject_restriction:
                        class_subjects = class_subjects.filter(subject_id__in=subject_restriction[key])
                    for cs in class_subjects:
                        slot = date_sheet_map.get((key, cs.subject_id), {})
                        all_exam_subjects.append(ExamSubject(
                            school_id=school_id,
                            exam=exam,
                            subject=cs.subject,
                            total_marks=default_total,
                            passing_marks=default_passing,
                            exam_date=slot.get('exam_date'),
                            start_time=slot.get('start_time'),
                            end_time=slot.get('end_time'),
                        ))

                if all_exam_subjects:
                    ExamSubject.objects.bulk_create(all_exam_subjects, ignore_conflicts=True)
        except IntegrityError:
            return Response({
                'detail': (
                    'This exam could not be created because it conflicts with an '
                    'existing record. Please refresh the page and try again.'
                ),
            }, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'group_id': group.id,
            'group_name': group.name,
            'exams_created': len(created_exams),
            'subjects_created': len(all_exam_subjects),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'patch'], url_path='date-sheet')
    def date_sheet(self, request, pk=None):
        """GET: subjects with dates. PATCH: bulk-update exam_date."""
        group = self.get_object()
        school_id = _resolve_school_id(request)

        if request.method == 'GET':
            exam_subjects = ExamSubject.objects.filter(
                exam__exam_group=group,
                exam__is_active=True,
                is_active=True,
                school_id=school_id,
            ).select_related('subject', 'exam', 'exam__class_obj').order_by(
                'subject__name', 'exam__class_obj__grade_level',
            )

            by_subject = {}
            for es in exam_subjects:
                sid = es.subject_id
                if sid not in by_subject:
                    by_subject[sid] = {
                        'subject_id': sid,
                        'subject_name': es.subject.name,
                        'subject_code': es.subject.code,
                        'exam_date': str(es.exam_date) if es.exam_date else None,
                        'classes': [],
                    }
                by_subject[sid]['classes'].append({
                    'exam_subject_id': es.id,
                    'exam_id': es.exam_id,
                    'class_name': es.exam.class_obj.name,
                    'exam_date': str(es.exam_date) if es.exam_date else None,
                    'start_time': str(es.start_time) if es.start_time else None,
                    'end_time': str(es.end_time) if es.end_time else None,
                })

            return Response({
                'group_id': group.id,
                'group_name': group.name,
                'start_date': group.start_date,
                'end_date': group.end_date,
                'subjects': list(by_subject.values()),
            })

        # PATCH
        serializer = DateSheetUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        updated_count = 0
        for entry in serializer.validated_data['date_sheet']:
            es_id = entry.get('exam_subject_id')
            if not es_id:
                continue
            update_fields = {}
            if 'exam_date' in entry:
                update_fields['exam_date'] = entry['exam_date']
            if 'start_time' in entry:
                update_fields['start_time'] = entry['start_time']
            if 'end_time' in entry:
                update_fields['end_time'] = entry['end_time']
            if update_fields:
                count = ExamSubject.objects.filter(
                    id=es_id, exam__exam_group=group, school_id=school_id,
                ).update(**update_fields)
                updated_count += count

        return Response({'updated_count': updated_count})

    @action(detail=True, methods=['post'], url_path='update-date-by-subject')
    def update_date_by_subject(self, request, pk=None):
        """Set the same exam_date for a subject across ALL classes in the group."""
        group = self.get_object()
        school_id = _resolve_school_id(request)
        subject_id = request.data.get('subject_id')
        exam_date = request.data.get('exam_date')

        if not subject_id:
            return Response({'detail': 'subject_id required.'}, status=status.HTTP_400_BAD_REQUEST)

        count = ExamSubject.objects.filter(
            exam__exam_group=group, subject_id=subject_id, school_id=school_id,
        ).update(exam_date=exam_date or None)

        return Response({'updated_count': count})

    @action(detail=True, methods=['get'], url_path='download-date-sheet')
    def download_date_sheet(self, request, pk=None):
        """Generate and return the date sheet as an Excel calendar grid
        (one row per exam date, one column per class)."""
        group = self.get_object()
        school_id = _resolve_school_id(request)
        grid = _build_date_sheet_grid(group, school_id)

        import openpyxl
        from openpyxl.drawing.image import Image as XLImage
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

        from .pdf_generator import _load_logo_stream

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Date Sheet'

        last_col = 2 + len(grid['columns'])  # Date + Day + one per class

        # Logo (if available) pushes the title/subtitle rows down so it doesn't
        # overlap them -- same _load_logo_stream helper the PDF export uses, so
        # a bad/unreachable logo degrades to "no logo" here too instead of
        # failing the whole export.
        row_offset = 0
        logo_stream = _load_logo_stream(group.school)
        if logo_stream:
            try:
                xl_logo = XLImage(logo_stream)
                xl_logo.width = 60
                xl_logo.height = 60
                ws.add_image(xl_logo, 'A1')
                ws.row_dimensions[1].height = 46
                row_offset = 3
            except Exception as e:
                logger.warning(f"Could not embed school logo in date sheet Excel: {str(e)}")

        title_row = 1 + row_offset
        subtitle_row = 2 + row_offset

        ws.merge_cells(start_row=title_row, start_column=1, end_row=title_row, end_column=last_col)
        ws.cell(row=title_row, column=1, value=f'Date Sheet - {group.name}').font = Font(bold=True, size=14)

        ws.merge_cells(start_row=subtitle_row, start_column=1, end_row=subtitle_row, end_column=last_col)
        period = ''
        if group.start_date and group.end_date:
            period = f' | {group.start_date} to {group.end_date}'
        ws.cell(row=subtitle_row, column=1, value=f'Exam Type: {group.exam_type.name}{period}').font = Font(size=10, color='555555')

        header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
        header_font = Font(bold=True, color='FFFFFF', size=10)
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin'),
        )

        header_row = 4 + row_offset
        headers = ['Date', 'Day'] + [col['label'] for col in grid['columns']]
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=header_row, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center', wrap_text=True)
            cell.border = thin_border

        row_idx = header_row + 1
        for row in grid['rows']:
            ws.cell(row=row_idx, column=1, value=row['date']).border = thin_border
            ws.cell(row=row_idx, column=2, value=row['day_name']).border = thin_border
            for col_idx, col in enumerate(grid['columns'], 3):
                value = row['cells'].get(col['class_id'], '')
                cell = ws.cell(row=row_idx, column=col_idx, value=value or '-')
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
            row_idx += 1

        ws.column_dimensions['A'].width = 14
        ws.column_dimensions['B'].width = 12
        for col_idx in range(3, last_col + 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = 18

        if grid['unscheduled']:
            row_idx += 1
            ws.cell(row=row_idx, column=1, value='Not yet scheduled:').font = Font(bold=True, size=10)
            for item in grid['unscheduled']:
                row_idx += 1
                ws.cell(row=row_idx, column=1, value=f"{item['subject_name']} ({item['class_name']})")

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f'DateSheet_{group.name.replace(" ", "_")}.xlsx'
        response = HttpResponse(
            buffer.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=['get'], url_path='download-date-sheet-pdf')
    def download_date_sheet_pdf(self, request, pk=None):
        """Generate and return the date sheet as a printable PDF calendar grid."""
        from .pdf_generator import DateSheetPDFGenerator

        group = self.get_object()
        school_id = _resolve_school_id(request)
        grid = _build_date_sheet_grid(group, school_id)

        try:
            generator = DateSheetPDFGenerator(group, grid)
            pdf_bytes = generator.generate()

            filename = f'DateSheet_{group.name.replace(" ", "_")}.pdf'
            response = HttpResponse(pdf_bytes, content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            return response
        except Exception as e:
            return Response(
                {'detail': f'Error generating PDF: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='publish-schedule-all')
    def publish_schedule_all(self, request, pk=None):
        """Publish schedules for every exam in the group -- see Exam.publish_schedule."""
        from django.utils import timezone
        from notifications.triggers import trigger_exam_schedule_published

        group = self.get_object()
        exams = list(
            group.exams.filter(is_active=True).select_related('school', 'class_obj', 'academic_year')
        )
        now = timezone.now()
        Exam.objects.filter(id__in=[exam.id for exam in exams]).update(schedule_published_at=now)
        for exam in exams:
            exam.schedule_published_at = now
            try:
                trigger_exam_schedule_published(exam)
            except Exception:
                # Do not block publish if notification fanout fails.
                pass
        return Response({'published_count': len(exams)})

    @action(detail=True, methods=['post'], url_path='unpublish-schedule-all')
    def unpublish_schedule_all(self, request, pk=None):
        """Hide schedules for every exam in the group again -- see Exam.unpublish_schedule."""
        group = self.get_object()
        exams = list(group.exams.filter(is_active=True))
        Exam.objects.filter(id__in=[exam.id for exam in exams]).update(schedule_published_at=None)
        return Response({'unpublished_count': len(exams)})

    @action(detail=True, methods=['post'], url_path='announce-results-all')
    def announce_results_all(self, request, pk=None):
        """Announce results for every exam in the group -- this is what the old
        'publish-all' action used to do -- see Exam.announce_results.

        A group spans several classes (exams), each with independent marks-entry
        progress, so this can't hard-block the whole request the way the single-exam
        announce_results does: it publishes whichever exams have complete marks and
        reports the rest as skipped, mirroring bulk_delete_skips_papers_outside_manage_scope's
        "do what's allowed, report what's not" shape.
        """
        from notifications.triggers import trigger_exam_result_published

        group = self.get_object()
        exams_qs = group.exams.filter(is_active=True).select_related(
            'school', 'class_obj', 'academic_year',
        ).annotate(
            subjects_count=Count('exam_subjects', filter=Q(exam_subjects__is_active=True)),
        )
        exams_qs = _annotate_marks_completion(exams_qs)
        exams = list(exams_qs)

        # Already-announced classes are left alone: re-publishing them would re-send
        # the results notification to their parents/students/teachers.
        pending = [exam for exam in exams if exam.status != Exam.Status.PUBLISHED]
        ready = [exam for exam in pending if _marks_entry_complete(exam)]
        skipped = [exam for exam in pending if not _marks_entry_complete(exam)]

        Exam.objects.filter(id__in=[exam.id for exam in ready]).update(status=Exam.Status.PUBLISHED)
        for exam in ready:
            exam.status = Exam.Status.PUBLISHED
            try:
                trigger_exam_result_published(exam)
            except Exception:
                # Do not block publish if notification fanout fails.
                pass
        return Response({
            'published_count': len(ready),
            'skipped': [
                {
                    'id': exam.id,
                    'class_name': exam.class_obj.name if exam.class_obj_id else None,
                    'marks_entered_count': exam.marks_entered_count,
                    'marks_expected_count': exam.subjects_count * exam.enrolled_count,
                }
                for exam in skipped
            ],
        })

    @action(detail=True, methods=['post'], url_path='unpublish-results-all')
    def unpublish_results_all(self, request, pk=None):
        """Withdraw announced results for every exam in the group -- see Exam.unpublish_results."""
        group = self.get_object()
        exams = list(group.exams.filter(is_active=True))
        Exam.objects.filter(id__in=[exam.id for exam in exams]).update(status=Exam.Status.COMPLETED)
        return Response({'unpublished_count': len(exams)})


class StudentResponseViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = StudentResponse.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action == 'create':
            return StudentResponseBulkSubmitSerializer
        return StudentResponseSerializer

    def get_queryset(self):
        queryset = self.queryset.select_related('student', 'question', 'exam_paper', 'exam_paper__school')
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(exam_paper__school_id=school_id)
        elif self.request.headers.get('X-School-ID'):
            return queryset.none()

        exam_paper_id = self.request.query_params.get('exam_paper')
        if exam_paper_id:
            queryset = queryset.filter(exam_paper_id=exam_paper_id)

        student_id = self.request.query_params.get('student')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        question_id = self.request.query_params.get('question')
        if question_id:
            queryset = queryset.filter(question_id=question_id)

        return queryset

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        exam_paper = serializer.validated_data['exam_paper_obj']
        student = serializer.validated_data['student_obj']
        responses = serializer.validated_data['responses']
        school_id = _resolve_school_id(request)
        if school_id and exam_paper.school_id != school_id:
            raise ValidationError({'exam_paper': 'Exam paper is outside the active school context.'})

        created_count = 0
        updated_count = 0
        changed_question_ids = set()
        saved_responses = []

        with transaction.atomic():
            for entry in responses:
                response_obj, created = StudentResponse.objects.update_or_create(
                    student=student,
                    question_id=entry['question'],
                    exam_paper=exam_paper,
                    defaults={
                        'response_text': entry.get('response_text', ''),
                        'marks_awarded': entry.get('marks_awarded'),
                        'is_correct': entry.get('is_correct'),
                        'time_taken_seconds': entry.get('time_taken_seconds'),
                    },
                )
                saved_responses.append(response_obj)
                changed_question_ids.add(response_obj.question_id)
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        from core.task_utils import call_task
        for question_id in changed_question_ids:
            call_task(recompute_question_stats, question_id)

        response_serializer = StudentResponseSerializer(saved_responses, many=True)
        return Response(
            {
                'created_count': created_count,
                'updated_count': updated_count,
                'responses': response_serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )


class ExamViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = Exam.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExamCreateSerializer
        return ExamSerializer

    def get_permissions(self):
        # edit/regenerate-comment and the bulk comment-generation actions enforce
        # class/subject scope themselves (_comment_target / _assert_can_bulk_generate_comments),
        # so teachers must get past the admin-only default here.
        if self.action in (
            'bulk_test_preview', 'bulk_test_apply', 'edit_comment', 'regenerate_comment',
            'generate_comments', 'comment_job', 'cancel_comment_job',
        ):
            return [IsAuthenticated(), HasSchoolAccess()]
        return super().get_permissions()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        from academic_sessions.utils import annotate_session_class_display

        qs = super().get_queryset().select_related(
            'school', 'academic_year', 'term', 'exam_type', 'class_obj', 'exam_group',
        ).annotate(
            subjects_count=Count('exam_subjects', filter=Q(exam_subjects__is_active=True)),
        )
        qs = _annotate_marks_completion(qs)
        qs = annotate_session_class_display(qs)
        qs = _apply_teacher_exam_scope(qs, self.request, class_field='class_obj_id')
        scope = resolve_class_scope(
            self.request,
            school_id=_resolve_school_id(self.request),
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return qs.none()

        academic_year = scope['academic_year_id'] or self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        term = self.request.query_params.get('term')
        if term:
            qs = qs.filter(term_id=term)
        class_obj = scope['class_obj_id']
        if class_obj:
            qs = qs.filter(class_obj_id=class_obj)
        if scope['session_class_id']:
            # A section sees whole-class exams plus its own section exams,
            # not a sibling section's.
            qs = qs.filter(Q(session_class__isnull=True) | Q(session_class_id=scope['session_class_id']))
        exam_type = self.request.query_params.get('exam_type')
        if exam_type:
            qs = qs.filter(exam_type_id=exam_type)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        exam_group = self.request.query_params.get('exam_group')
        if exam_group:
            qs = qs.filter(exam_group_id=exam_group)
        ungrouped = self.request.query_params.get('ungrouped')
        if ungrouped and ungrouped.lower() == 'true':
            qs = qs.filter(exam_group__isnull=True)
        schedule_published = self.request.query_params.get('schedule_published')
        if schedule_published is not None:
            qs = qs.filter(schedule_published_at__isnull=not (schedule_published.lower() == 'true'))
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        super().perform_create(serializer)
        exam = serializer.instance
        # Auto-create ExamSubject entries from the class's (or section's) subjects
        class_subjects = _exam_class_subjects(exam)
        exam_subjects = [
            ExamSubject(
                school_id=exam.school_id,
                exam=exam,
                subject=cs.subject,
            )
            for cs in class_subjects
        ]
        if exam_subjects:
            ExamSubject.objects.bulk_create(exam_subjects, ignore_conflicts=True)

    @action(detail=False, methods=['post'], url_path='bulk-test-preview')
    def bulk_test_preview(self, request):
        serializer = BulkTestRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preview = _build_bulk_test_plan(request, serializer.validated_data)
        return Response(preview)

    @action(detail=False, methods=['post'], url_path='bulk-test-apply')
    def bulk_test_apply(self, request):
        serializer = BulkTestRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preview = _build_bulk_test_plan(request, serializer.validated_data)
        if not preview['can_apply']:
            return Response(
                {
                    **preview,
                    'detail': 'Preview contains conflicts or inaccessible subjects. Resolve them before applying.',
                },
                status=status.HTTP_409_CONFLICT,
            )

        school_id = _resolve_school_id(request)
        created_tests = []
        try:
            with transaction.atomic():
                for item in preview['tests']:
                    exam = Exam.objects.create(
                        school_id=school_id,
                        academic_year_id=preview['academic_year'],
                        term_id=preview['term'],
                        exam_type_id=preview['exam_type'],
                        class_obj_id=preview['class_obj'],
                        exam_group=None,
                        name=item['name'],
                        start_date=item['exam_date'],
                        end_date=item['exam_date'],
                        status=Exam.Status.SCHEDULED,
                    )
                    ExamSubject.objects.create(
                        school_id=school_id,
                        exam=exam,
                        subject_id=item['subject_id'],
                        total_marks=item.get('total_marks') or Decimal('100.00'),
                        passing_marks=((item.get('total_marks') or Decimal('100.00')) * Decimal('0.33')).quantize(Decimal('0.01')),
                        exam_date=item['exam_date'],
                        start_time=item.get('start_time'),
                        end_time=item.get('end_time'),
                    )
                    created_tests.append({
                        'exam_id': exam.id,
                        'name': exam.name,
                        'subject_id': item['subject_id'],
                        'subject_name': item['subject_name'],
                        'exam_date': item['exam_date'],
                        'total_marks': item.get('total_marks') or Decimal('100.00'),
                    })
        except IntegrityError as exc:
            message = str(exc)
            legacy_constraint = 'examinations_exam_school_id_exam_type_id_c_bf67c535_uniq'
            if legacy_constraint in message:
                return Response(
                    {
                        **preview,
                        'detail': (
                            'Your database still enforces the legacy standalone-test uniqueness constraint. '
                            'Run examinations migrations (including 0015+) and retry.'
                        ),
                        'constraint': legacy_constraint,
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(
                {
                    **preview,
                    'detail': 'A database integrity error occurred while creating tests. Please retry.',
                },
                status=status.HTTP_409_CONFLICT,
            )

        return Response({
            'created_count': len(created_tests),
            'created_tests': created_tests,
            'class_name': preview['class_name'],
            'exam_type_name': preview['exam_type_name'],
            'academic_year_name': preview['academic_year_name'],
            'term_name': preview['term_name'],
        }, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.delete()  # Cascades to ExamSubject → StudentMark

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        """POST /api/examinations/exams/bulk_delete/  Body: {"ids": [1, 2, 3]}"""
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = self.get_queryset().filter(id__in=ids)
        deleted_count = queryset.count()
        queryset.delete()  # Cascades (CASCADE) to ExamSubject -> StudentMark
        return Response({'requested_count': len(ids), 'deleted_count': deleted_count})

    @action(detail=True, methods=['post'], url_path='publish-schedule')
    def publish_schedule(self, request, pk=None):
        """Make this class's exam dates visible to its own students/parents/teachers.

        Deliberately independent of `status`/results -- see Exam.schedule_published_at.
        """
        from django.utils import timezone
        from notifications.triggers import trigger_exam_schedule_published

        exam = self.get_object()
        exam.schedule_published_at = timezone.now()
        exam.save(update_fields=['schedule_published_at'])
        try:
            trigger_exam_schedule_published(exam)
        except Exception:
            # Do not block publish if notification fanout fails.
            pass
        return Response(ExamSerializer(exam).data)

    @action(detail=True, methods=['post'], url_path='unpublish-schedule')
    def unpublish_schedule(self, request, pk=None):
        """Hide this class's exam dates again (e.g. dates are being reworked)."""
        exam = self.get_object()
        exam.schedule_published_at = None
        exam.save(update_fields=['schedule_published_at'])
        return Response(ExamSerializer(exam).data)

    @action(detail=True, methods=['post'], url_path='announce-results')
    def announce_results(self, request, pk=None):
        """Publish this exam's results/report card. This is what the old
        'publish' action used to do -- see Exam.Status.PUBLISHED.

        Hard-blocked until marks entry is complete (no force-override): announcing
        partial results would show students/parents an incomplete report card.
        """
        exam = self.get_object()
        if not _marks_entry_complete(exam):
            expected = exam.subjects_count * exam.enrolled_count
            return Response(
                {
                    'detail': f'Marks entry is incomplete ({exam.marks_entered_count}/{expected} entered). '
                              'Enter all marks before announcing results.',
                    'marks_entered_count': exam.marks_entered_count,
                    'marks_expected_count': expected,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        exam.status = Exam.Status.PUBLISHED
        exam.save(update_fields=['status'])
        try:
            from notifications.triggers import trigger_exam_result_published
            trigger_exam_result_published(exam)
        except Exception:
            # Do not block publish if notification fanout fails.
            pass
        return Response(ExamSerializer(exam).data)

    @action(detail=True, methods=['post'], url_path='unpublish-results')
    def unpublish_results(self, request, pk=None):
        """Withdraw an announced result, reverting to COMPLETED (marks are
        entered/finalized, just not announced)."""
        exam = self.get_object()
        exam.status = Exam.Status.COMPLETED
        exam.save(update_fields=['status'])
        return Response(ExamSerializer(exam).data)

    @action(detail=True, methods=['post'], url_path='generate-comments')
    def generate_comments(self, request, pk=None):
        """AI: Generate personalized report card comments for all marks in this exam.

        Uses AI to generate 2-3 sentence comments based on each student's marks,
        grade, and attendance record. Comments can be edited by teachers after generation.
        Skips marks that already have AI comments (use force=true to regenerate all).
        """
        exam = self.get_object()
        school_id = _resolve_school_id(request)
        force = request.data.get('force', False)

        if not school_id:
            return Response({'detail': 'No school selected.'}, status=status.HTTP_400_BAD_REQUEST)
        _assert_can_bulk_generate_comments(request, exam, school_id)

        # If force=true, clear existing generated comments first -- but never ones a
        # person has edited by hand.
        if force:
            StudentMark.objects.filter(
                exam_subject__exam=exam,
                school_id=school_id,
            ).exclude(ai_comment_source='EDITED').update(
                ai_comment='', ai_comment_generated_at=None, ai_comment_source=None, ai_model=None,
            )
            StudentExamComment.objects.filter(
                exam=exam, school_id=school_id,
            ).exclude(source='EDITED').delete()

        from . import comment_jobs
        task, started = comment_jobs.start_job(exam, school_id, request.user)
        return Response(
            {**comment_jobs.job_payload(task), 'started': started},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=['get'], url_path='comment-job')
    def comment_job(self, request, pk=None):
        """Progress of the latest comment-generation run for this exam."""
        from . import comment_jobs
        exam = self.get_object()
        task = comment_jobs.latest_job(exam.id, _resolve_school_id(request))
        return Response(comment_jobs.job_payload(task))

    @action(detail=True, methods=['post'], url_path='cancel-comment-job')
    def cancel_comment_job(self, request, pk=None):
        """Ask the running generation to stop after the students already in flight."""
        from . import comment_jobs
        exam = self.get_object()
        school_id = _resolve_school_id(request)
        _assert_can_bulk_generate_comments(request, exam, school_id)
        task = comment_jobs.request_cancel(exam.id, school_id)
        return Response(comment_jobs.job_payload(task))

    def _comment_target(self, request, exam):
        """Resolve + authorise the comment being edited/regenerated.

        subject_id omitted/null = the student's overall comment (class-teacher or
        admin only); otherwise that subject's comment (class teacher or the assigned
        subject teacher, same scope as marks entry). Returns (school_id, student_id,
        subject_id, mark_or_None) or raises PermissionDenied / ValidationError.
        """
        school_id = _resolve_school_id(request)
        student_id = request.data.get('student_id')
        subject_id = request.data.get('subject_id') or None
        if not student_id:
            raise ValidationError({'detail': 'student_id is required.'})
        student_id = int(student_id)
        if subject_id is None:
            role = get_effective_role(request)
            allowed = role in ADMIN_ROLES or role == 'MANAGER' or (
                role == 'TEACHER'
                and _is_teacher_class_teacher_for_class(request, exam.class_obj_id, school_id=school_id)
            )
            if not allowed:
                raise PermissionDenied('Only admins or the class teacher can change the overall comment.')
            return school_id, student_id, None, None
        subject_id = int(subject_id)
        if not _can_manage_exam_scope(
            request, class_id=exam.class_obj_id, subject_id=subject_id, school_id=school_id,
        ):
            raise PermissionDenied('You can only change comments for your own class and subject.')
        mark = StudentMark.objects.filter(
            exam_subject__exam=exam, exam_subject__subject_id=subject_id,
            student_id=student_id, school_id=school_id,
        ).first()
        if not mark:
            raise ValidationError({'detail': 'No marks found for that student and subject.'})
        return school_id, student_id, subject_id, mark

    @action(detail=True, methods=['post'], url_path='edit-comment')
    def edit_comment(self, request, pk=None):
        """Save a hand-edited subject or overall comment (source becomes EDITED, so
        regeneration never overwrites it)."""
        exam = self.get_object()
        school_id, student_id, subject_id, mark = self._comment_target(request, exam)
        text = (request.data.get('comment') or '').strip()
        if len(text) > 800:
            return Response({'detail': 'Comment is too long (800 characters max).'}, status=400)
        now = timezone.now()
        if subject_id is None:
            StudentExamComment.objects.update_or_create(
                exam=exam, student_id=student_id, school_id=school_id,
                defaults={'comment': text, 'source': 'EDITED', 'generated_at': now, 'ai_model': None},
            )
        else:
            mark.ai_comment = text
            mark.ai_comment_source = 'EDITED' if text else None
            mark.ai_comment_generated_at = now if text else None
            mark.ai_model = None
            mark.save(update_fields=['ai_comment', 'ai_comment_source', 'ai_comment_generated_at', 'ai_model'])
        return Response({'saved': True, 'source': 'EDITED' if text else None})

    @action(detail=True, methods=['post'], url_path='regenerate-comment')
    def regenerate_comment(self, request, pk=None):
        """Regenerate ONE comment (explicit request, so it may replace a hand edit)."""
        exam = self.get_object()
        school_id, student_id, subject_id, mark = self._comment_target(request, exam)
        if subject_id is None:
            StudentExamComment.objects.filter(exam=exam, student_id=student_id, school_id=school_id).delete()
        else:
            mark.ai_comment = ''
            mark.ai_comment_source = None
            mark.ai_comment_generated_at = None
            mark.ai_model = None
            mark.save(update_fields=['ai_comment', 'ai_comment_source', 'ai_comment_generated_at', 'ai_model'])
        from schools.models import School
        from .ai_comments_service import ReportCardCommentGenerator
        result = ReportCardCommentGenerator(School.objects.get(id=school_id)).generate_for_exam(
            exam.id, only_student_id=student_id,
        )
        return Response(result)

    @action(detail=True, methods=['post'], url_path='populate-subjects')
    def populate_subjects(self, request, pk=None):
        """Re-sync exam subjects from the class's current ClassSubject assignments."""
        exam = self.get_object()
        school_id = _resolve_school_id(request)

        class_subjects = _exam_class_subjects(exam)

        existing_subject_ids = set(
            exam.exam_subjects.filter(is_active=True).values_list('subject_id', flat=True)
        )

        new_exam_subjects = [
            ExamSubject(school_id=school_id, exam=exam, subject=cs.subject)
            for cs in class_subjects
            if cs.subject_id not in existing_subject_ids
        ]

        created = []
        if new_exam_subjects:
            created = ExamSubject.objects.bulk_create(new_exam_subjects, ignore_conflicts=True)

        return Response({
            'added_count': len(created),
            'total_count': exam.exam_subjects.filter(is_active=True).count(),
        })

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        exam = self.get_object()
        school_id = _resolve_school_id(request)
        exam_subjects = exam.exam_subjects.filter(is_active=True).select_related('subject')

        students, roll_by_student = _exam_roster(
            school_id, exam, session_class_id=_exam_section_param(request, school_id, exam),
        )

        grade_scales = list(GradeScale.objects.filter(
            school_id=school_id, is_active=True,
        ).order_by('-min_percentage'))

        # Prefetch all marks in one query and build lookup dict
        all_marks = StudentMark.objects.filter(
            exam_subject__in=exam_subjects, school_id=school_id,
        ).select_related('exam_subject')
        marks_lookup = {
            (m.student_id, m.exam_subject_id): m for m in all_marks
        }
        overall_comments = {
            c.student_id: c for c in StudentExamComment.objects.filter(exam=exam, school_id=school_id)
        }

        results = []
        for student in students:
            marks_list = []
            total_obtained = Decimal('0')
            total_possible = Decimal('0')
            all_pass = True
            is_incomplete = False

            for es in exam_subjects:
                mark = marks_lookup.get((student.id, es.id))
                obtained = mark.marks_obtained if mark and not mark.is_absent else None
                is_absent = mark.is_absent if mark else False
                if obtained is None and not is_absent:
                    is_incomplete = True

                marks_list.append({
                    'subject_id': es.subject_id,
                    'subject_name': es.subject.name,
                    'total_marks': float(es.total_marks),
                    'passing_marks': float(es.passing_marks),
                    'marks_obtained': float(obtained) if obtained is not None else None,
                    'is_absent': is_absent,
                    'is_pass': obtained is not None and obtained >= es.passing_marks,
                    'ai_comment': mark.ai_comment if mark else '',
                    'comment_source': (mark.ai_comment_source or None) if mark else None,
                    'comment_at': mark.ai_comment_generated_at.isoformat() if mark and mark.ai_comment_generated_at else None,
                    'comment_model': (mark.ai_model or None) if mark else None,
                })

                if obtained is not None:
                    total_obtained += obtained
                    total_possible += es.total_marks
                    if obtained < es.passing_marks:
                        all_pass = False
                else:
                    total_possible += es.total_marks
                    all_pass = False

            percentage = float(total_obtained / total_possible * 100) if total_possible > 0 else 0
            grade_label = self._get_grade(percentage, grade_scales)

            results.append({
                'student_id': student.id,
                'student_name': student.name,
                'roll_number': roll_by_student.get(student.id, student.roll_number),
                'marks': marks_list,
                'total_obtained': float(total_obtained),
                'total_possible': float(total_possible),
                'percentage': round(percentage, 2),
                'grade': grade_label,
                'is_pass': all_pass,
                'is_incomplete': is_incomplete,
                'overall_comment': overall_comments[student.id].comment if student.id in overall_comments else '',
                'overall_comment_source': overall_comments[student.id].source if student.id in overall_comments else None,
                'overall_comment_model': overall_comments[student.id].ai_model if student.id in overall_comments else None,
                'overall_comment_at': (
                    overall_comments[student.id].generated_at.isoformat()
                    if student.id in overall_comments and overall_comments[student.id].generated_at else None
                ),
            })

        # Dense ranking: equal percentages share a rank and the next distinct score
        # is rank+1 (1,1,1,2). Students with a subject not yet entered are left
        # unranked so half-finished results can't take a top position.
        results.sort(key=lambda x: (x['is_incomplete'], -x['percentage']))
        prev_pct, current_rank = None, 0
        for r in results:
            if r['is_incomplete']:
                r['rank'] = None
                continue
            pct = round(r['percentage'], 2)
            if pct != prev_pct:
                current_rank += 1
                prev_pct = pct
            r['rank'] = current_rank

        return Response({
            'exam': ExamSerializer(exam).data,
            'exam_type_weight': float(exam.exam_type.weight),
            'subjects': ExamSubjectSerializer(exam_subjects, many=True).data,
            'results': results,
        })

    @action(detail=True, methods=['get'])
    def class_summary(self, request, pk=None):
        exam = self.get_object()
        school_id = _resolve_school_id(request)
        exam_subjects = exam.exam_subjects.filter(is_active=True).select_related('subject')

        students, _roll_by_student = _exam_roster(
            school_id, exam, session_class_id=_exam_section_param(request, school_id, exam),
        )

        # Prefetch all marks for this exam in one query
        all_marks = StudentMark.objects.filter(
            exam_subject__in=exam_subjects, school_id=school_id,
            is_absent=False, marks_obtained__isnull=False,
        )
        # Group marks by exam_subject_id
        marks_by_subject = {}
        for m in all_marks:
            marks_by_subject.setdefault(m.exam_subject_id, []).append(m)

        subject_stats = []
        for es in exam_subjects:
            subject_marks = marks_by_subject.get(es.id, [])
            marks_values = [float(m.marks_obtained) for m in subject_marks]
            passed = sum(1 for m in subject_marks if m.marks_obtained >= es.passing_marks)
            subject_stats.append({
                'subject_name': es.subject.name,
                'total_marks': float(es.total_marks),
                'students_appeared': len(marks_values),
                'average': round(sum(marks_values) / len(marks_values), 2) if marks_values else 0,
                'highest': max(marks_values) if marks_values else 0,
                'lowest': min(marks_values) if marks_values else 0,
                'passed': passed,
                'failed': len(marks_values) - passed,
            })

        return Response({
            'exam': ExamSerializer(exam).data,
            'total_students': len(students),
            'subject_stats': subject_stats,
        })

    def _get_grade(self, percentage, grade_scales):
        for gs in grade_scales:
            if float(gs.min_percentage) <= percentage <= float(gs.max_percentage):
                return gs.grade_label
        return '-'


class ExamSubjectViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = ExamSubject.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExamSubjectCreateSerializer
        return ExamSubjectSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school', 'exam', 'subject')
        qs = _apply_teacher_exam_scope(
            qs,
            self.request,
            class_field='exam__class_obj_id',
            subject_field='subject_id',
        )
        scope = resolve_class_scope(
            self.request,
            school_id=_resolve_school_id(self.request),
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return qs.none()

        exam = self.request.query_params.get('exam')
        if exam:
            qs = qs.filter(exam_id=exam)
        class_obj = scope['class_obj_id']
        if class_obj:
            qs = qs.filter(exam__class_obj_id=class_obj)
        academic_year = scope['academic_year_id'] or self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(exam__academic_year_id=academic_year)
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    def perform_destroy(self, instance):
        instance.delete()  # Cascades to StudentMark


class StudentMarkViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = StudentMark.objects.all()
    # Write access isn't admin-only: a teacher may enter marks for their own
    # class-teacher or assigned-subject scope. IsSchoolAdminOrReadOnly would
    # block that, so scoping is enforced per-action via _can_manage_exam_scope
    # in perform_create/perform_update/perform_destroy/bulk_entry instead.
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StudentMarkCreateSerializer
        return StudentMarkSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def _check_exam_subject_scope(self, exam_subject, school_id):
        if not _can_manage_exam_scope(
            self.request,
            class_id=exam_subject.exam.class_obj_id,
            subject_id=exam_subject.subject_id,
            school_id=school_id,
        ):
            raise PermissionDenied(
                'Only School Admin, Principal, or assigned class/subject teachers can enter marks for this exam subject.'
            )

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        exam_subject = serializer.validated_data.get('exam_subject')
        self._check_exam_subject_scope(exam_subject, school_id)
        # TenantQuerySetMixin.perform_create resolves/validates school_id and saves.
        super().perform_create(serializer)

    def perform_update(self, serializer):
        school_id = _resolve_school_id(self.request)
        exam_subject = serializer.validated_data.get('exam_subject', serializer.instance.exam_subject)
        self._check_exam_subject_scope(exam_subject, school_id)
        serializer.save()

    def perform_destroy(self, instance):
        school_id = _resolve_school_id(self.request)
        self._check_exam_subject_scope(instance.exam_subject, school_id)
        instance.delete()

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'school', 'exam_subject', 'exam_subject__subject',
            'exam_subject__exam', 'student',
        )
        qs = _apply_teacher_exam_scope(
            qs,
            self.request,
            class_field='exam_subject__exam__class_obj_id',
            subject_field='exam_subject__subject_id',
        )
        scope = resolve_class_scope(
            self.request,
            school_id=_resolve_school_id(self.request),
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return qs.none()

        exam_subject = self.request.query_params.get('exam_subject')
        if exam_subject:
            qs = qs.filter(exam_subject_id=exam_subject)
        student = self.request.query_params.get('student')
        if student:
            qs = qs.filter(student_id=student)
        class_obj = scope['class_obj_id']
        if class_obj:
            qs = qs.filter(exam_subject__exam__class_obj_id=class_obj)

        academic_year = scope['academic_year_id'] or self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(exam_subject__exam__academic_year_id=academic_year)
        return qs

    @action(detail=False, methods=['post'])
    def bulk_entry(self, request):
        serializer = StudentMarkBulkEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        exam_subject_id = serializer.validated_data['exam_subject_id']
        marks_data = serializer.validated_data['marks']

        try:
            exam_subject = ExamSubject.objects.get(
                pk=exam_subject_id, school_id=school_id,
            )
        except ExamSubject.DoesNotExist:
            return Response(
                {'detail': 'Exam subject not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        self._check_exam_subject_scope(exam_subject, school_id)

        created = 0
        updated = 0
        errors = []

        from academic_sessions.models import StudentEnrollment

        for entry in marks_data:
            student_id = entry.get('student_id')
            marks_obtained = entry.get('marks_obtained')
            is_absent = entry.get('is_absent', False)
            remarks = entry.get('remarks', '')

            if marks_obtained is not None:
                marks_obtained = Decimal(str(marks_obtained))

            enrollment = StudentEnrollment.objects.filter(
                school_id=school_id,
                student_id=student_id,
                academic_year_id=exam_subject.exam.academic_year_id,
                class_obj_id=exam_subject.exam.class_obj_id,
            ).order_by('-is_active', '-created_at').first()

            try:
                mark, was_created = StudentMark.objects.update_or_create(
                    school_id=school_id,
                    exam_subject=exam_subject,
                    student_id=student_id,
                    defaults={
                        'marks_obtained': None if is_absent else marks_obtained,
                        'is_absent': is_absent,
                        'remarks': remarks,
                        'enrollment': enrollment,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            except Exception as e:
                errors.append({'student_id': student_id, 'error': str(e)})

        return Response({
            'created': created,
            'updated': updated,
            'errors': errors,
            'message': f'{created + updated} marks saved.',
        })

    @action(detail=False, methods=['get'])
    def download_template(self, request):
        """Generate Excel template pre-filled with student names for marks entry."""
        school_id = _resolve_school_id(request)
        exam_subject_id = request.query_params.get('exam_subject_id')
        if not exam_subject_id:
            return Response(
                {'detail': 'exam_subject_id param required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            exam_subject = ExamSubject.objects.select_related(
                'exam', 'exam__class_obj', 'subject',
            ).get(pk=exam_subject_id, school_id=school_id)
        except ExamSubject.DoesNotExist:
            return Response(
                {'detail': 'Exam subject not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get students enrolled in the exam's class for the exam's academic year
        from students.models import Student
        from academic_sessions.models import StudentEnrollment
        students = Student.objects.filter(
            school_id=school_id,
            class_obj=exam_subject.exam.class_obj,
            is_active=True,
        )
        # Filter by enrollment if the school uses enrollments
        academic_year_id = exam_subject.exam.academic_year_id
        if academic_year_id and StudentEnrollment.objects.filter(school_id=school_id).exists():
            enrolled_ids = StudentEnrollment.objects.filter(
                academic_year_id=academic_year_id,
                is_active=True,
            ).values_list('student_id', flat=True)
            students = students.filter(id__in=enrolled_ids)
        students = students.order_by('roll_number', 'name')

        # Also check for existing marks
        existing_marks = {
            m.student_id: m
            for m in StudentMark.objects.filter(
                school_id=school_id,
                exam_subject=exam_subject,
            )
        }

        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Marks Entry'

        # Header info rows
        header_font = Font(bold=True, size=12)
        info_font = Font(size=10, color='555555')
        ws.merge_cells('A1:E1')
        ws['A1'] = f'Marks Entry - {exam_subject.exam.name}'
        ws['A1'].font = header_font
        from academic_sessions.utils import resolve_class_display_name

        ws.merge_cells('A2:E2')
        ws['A2'] = (
            f'Subject: {exam_subject.subject.name} | '
            f'Class: {resolve_class_display_name(exam_subject.exam.school_id, exam_subject.exam.academic_year_id, exam_subject.exam.class_obj)} | '
            f'Total Marks: {exam_subject.total_marks} | '
            f'Passing: {exam_subject.passing_marks}'
        )
        ws['A2'].font = info_font

        # Hidden metadata row for upload parsing
        ws['A3'] = 'exam_subject_id'
        ws['B3'] = str(exam_subject.id)
        ws.row_dimensions[3].hidden = True

        # Column headers
        headers = ['Student ID', 'Roll Number', 'Student Name', f'Marks (out of {exam_subject.total_marks})', 'Absent (Y/N)', 'Remarks']
        header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
        header_font_white = Font(bold=True, color='FFFFFF', size=10)
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin'),
        )

        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col_idx, value=header)
            cell.font = header_font_white
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')
            cell.border = thin_border

        # Student rows
        for row_idx, student in enumerate(students, 5):
            existing = existing_marks.get(student.id)
            ws.cell(row=row_idx, column=1, value=student.id).border = thin_border
            ws.cell(row=row_idx, column=2, value=student.roll_number or '').border = thin_border
            name_cell = ws.cell(row=row_idx, column=3, value=student.name)
            name_cell.border = thin_border
            name_cell.font = Font(size=10)

            marks_cell = ws.cell(row=row_idx, column=4)
            if existing and existing.marks_obtained is not None:
                marks_cell.value = float(existing.marks_obtained)
            marks_cell.border = thin_border
            marks_cell.alignment = Alignment(horizontal='center')

            absent_cell = ws.cell(row=row_idx, column=5)
            if existing and existing.is_absent:
                absent_cell.value = 'Y'
            absent_cell.border = thin_border
            absent_cell.alignment = Alignment(horizontal='center')

            remarks_cell = ws.cell(row=row_idx, column=6)
            if existing and existing.remarks:
                remarks_cell.value = existing.remarks
            remarks_cell.border = thin_border

        # Column widths
        ws.column_dimensions['A'].width = 12
        ws.column_dimensions['B'].width = 14
        ws.column_dimensions['C'].width = 30
        ws.column_dimensions['D'].width = 20
        ws.column_dimensions['E'].width = 14
        ws.column_dimensions['F'].width = 25

        # Lock student ID and name columns (read-only visual cue)
        lock_fill = PatternFill(start_color='F2F2F2', end_color='F2F2F2', fill_type='solid')
        for row_idx in range(5, 5 + students.count()):
            ws.cell(row=row_idx, column=1).fill = lock_fill
            ws.cell(row=row_idx, column=2).fill = lock_fill
            ws.cell(row=row_idx, column=3).fill = lock_fill

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = (
            f'Marks_Template_{exam_subject.exam.name}_'
            f'{exam_subject.subject.code}.xlsx'
        ).replace(' ', '_')

        response = HttpResponse(
            buffer.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=['get'])
    def by_student(self, request):
        student_id = request.query_params.get('student_id')
        if not student_id:
            return Response(
                {'detail': 'student_id param required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        qs = self.get_queryset().filter(student_id=student_id)
        serializer = StudentMarkSerializer(qs, many=True)
        return Response(serializer.data)


class GradeScaleViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = GradeScale.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return GradeScaleCreateSerializer
        return GradeScaleSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    @cached_api('grade_scales', timeout=180)
    def list(self, request, *args, **kwargs):
        # Small, slow-changing reference list; invalidated by examinations/signals.py.
        return super().list(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


class StudentTermAssessmentView(ModuleAccessMixin, APIView):
    """
    Skills/behaviour ratings + remarks for one student's academic year + month (upsert).
    GET  ?student_id=&academic_year=&month= -> existing row, or a blank shape if none yet.
    POST {student, academic_year, month, ...ratings, teacher_remark, principal_remark} -> create/update.
    """
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, CanManageStudentAssessments, HasSchoolAccess]

    RATING_FIELDS = [
        'listening', 'speaking', 'writing', 'reading', 'participation', 'confidence', 'social_skills',
        'discipline', 'respect', 'teamwork', 'class_participation', 'responsibility',
    ]

    @staticmethod
    def _parse_month(raw_month):
        try:
            month = int(raw_month)
        except (TypeError, ValueError):
            return None
        return month if 1 <= month <= 12 else None

    def _teacher_can_access_class(self, request, school_id, academic_year_id, class_obj_id=None, session_class_id=None):
        role = get_effective_role(request)
        if role in ADMIN_ROLES:
            return True
        if role != 'TEACHER':
            return False

        scope = get_teacher_combined_scope(request, school_id=school_id, academic_year_id=academic_year_id)
        allowed_class_ids = set(scope.get('all_class_ids', set()))
        allowed_session_ids = set(scope.get('full_session_class_ids', set()))

        if session_class_id:
            return int(session_class_id) in allowed_session_ids or int(class_obj_id or 0) in allowed_class_ids
        if class_obj_id:
            return int(class_obj_id) in allowed_class_ids
        return False

    def _teacher_can_access_student(self, request, school_id, student_id, academic_year_id):
        role = get_effective_role(request)
        if role in ADMIN_ROLES:
            return True
        if role != 'TEACHER':
            return False

        from academic_sessions.models import StudentEnrollment

        enrollment = StudentEnrollment.objects.filter(
            school_id=school_id,
            student_id=student_id,
            academic_year_id=academic_year_id,
            is_active=True,
        ).select_related('session_class', 'class_obj').first()
        if not enrollment:
            return False

        return self._teacher_can_access_class(
            request,
            school_id,
            academic_year_id,
            class_obj_id=enrollment.class_obj_id,
            session_class_id=enrollment.session_class_id,
        )

    def _build_defaults(self, request, row, existing=None):
        role = get_effective_role(request)
        defaults = {
            field: (None if row.get(field) in (None, '') else row.get(field))
            for field in self.RATING_FIELDS
        }
        defaults['teacher_remark'] = row.get('teacher_remark', '')
        if role in ADMIN_ROLES:
            defaults['principal_remark'] = row.get('principal_remark', '')
        elif existing is not None:
            defaults['principal_remark'] = existing.principal_remark or ''
        else:
            defaults['principal_remark'] = ''
        defaults['updated_by'] = request.user
        return defaults

    def _reject_no_access(self):
        return Response({'detail': 'You are not assigned to this student/class for the selected academic year.'}, status=403)

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        student_id = request.query_params.get('student_id')
        academic_year_id = request.query_params.get('academic_year')
        month = self._parse_month(request.query_params.get('month'))
        if not student_id or not academic_year_id or month is None:
            return Response({'error': 'student_id, academic_year, and month (1-12) are required'}, status=400)

        if not self._teacher_can_access_student(request, school_id, student_id, academic_year_id):
            return self._reject_no_access()

        assessment = StudentTermAssessment.objects.filter(
            school_id=school_id,
            student_id=student_id,
            academic_year_id=academic_year_id,
            month=month,
        ).first()
        if not assessment:
            blank = {f: None for f in self.RATING_FIELDS}
            blank.update({
                'exists': False,
                'student': int(student_id),
                'academic_year': int(academic_year_id),
                'month': month,
                'teacher_remark': '', 'principal_remark': '',
            })
            return Response(blank)

        data = StudentTermAssessmentSerializer(assessment).data
        data['exists'] = True
        return Response(data)

    def post(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        student_id = request.data.get('student')
        academic_year_id = request.data.get('academic_year')
        month = self._parse_month(request.data.get('month'))
        if not student_id or not academic_year_id or month is None:
            return Response({'error': 'student, academic_year, and month (1-12) are required'}, status=400)

        if not self._teacher_can_access_student(request, school_id, student_id, academic_year_id):
            return self._reject_no_access()

        existing = StudentTermAssessment.objects.filter(
            school_id=school_id,
            student_id=student_id,
            academic_year_id=academic_year_id,
            month=month,
        ).first()
        defaults = self._build_defaults(request, request.data, existing=existing)

        assessment, _created = StudentTermAssessment.objects.update_or_create(
            school_id=school_id,
            student_id=student_id,
            academic_year_id=academic_year_id,
            month=month,
            defaults=defaults,
        )
        data = StudentTermAssessmentSerializer(assessment).data
        data['exists'] = True
        return Response(data)


class StudentTermAssessmentRosterView(ModuleAccessMixin, APIView):
    """
    Class/month roster for student assessments.
    GET ?academic_year=&month=&session_class= (or class_obj=) -> one row per enrolled student
    with existing monthly assessment data merged in.
    """
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, CanManageStudentAssessments, HasSchoolAccess]

    RATING_FIELDS = StudentTermAssessmentView.RATING_FIELDS

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        academic_year_id = request.query_params.get('academic_year')
        month = StudentTermAssessmentView._parse_month(request.query_params.get('month'))
        session_class_id = request.query_params.get('session_class')
        class_obj_id = request.query_params.get('class_obj')

        if not academic_year_id or month is None:
            return Response({'error': 'academic_year and month (1-12) are required'}, status=400)
        if not session_class_id and not class_obj_id:
            return Response({'error': 'session_class or class_obj is required'}, status=400)

        if not StudentTermAssessmentView()._teacher_can_access_class(
            request,
            school_id,
            academic_year_id,
            class_obj_id=class_obj_id,
            session_class_id=session_class_id,
        ):
            return Response({'detail': 'You are not assigned to this class for the selected academic year.'}, status=403)

        from academic_sessions.models import StudentEnrollment

        enrollments = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            is_active=True,
        ).select_related('student', 'session_class', 'class_obj')

        if session_class_id:
            enrollments = enrollments.filter(session_class_id=session_class_id)
        else:
            enrollments = enrollments.filter(class_obj_id=class_obj_id)

        enrollments = enrollments.order_by('roll_number', 'student__name', 'id')
        student_ids = list(enrollments.values_list('student_id', flat=True))

        assessments = StudentTermAssessment.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            month=month,
            student_id__in=student_ids,
        ).select_related('updated_by')
        assessments_by_student = {row.student_id: row for row in assessments}

        results = []
        for enrollment in enrollments:
            assessment = assessments_by_student.get(enrollment.student_id)
            if assessment:
                row = StudentTermAssessmentSerializer(assessment).data
                row['exists'] = True
            else:
                row = {f: None for f in self.RATING_FIELDS}
                row.update({
                    'exists': False,
                    'student': enrollment.student_id,
                    'academic_year': int(academic_year_id),
                    'month': month,
                    'teacher_remark': '',
                    'principal_remark': '',
                    'updated_by': None,
                    'updated_by_name': None,
                    'updated_at': None,
                })

            row['student_name'] = enrollment.student.name
            row['roll_number'] = enrollment.roll_number
            row['enrollment_id'] = enrollment.id
            row['class_obj'] = enrollment.class_obj_id
            row['session_class'] = enrollment.session_class_id
            results.append(row)

        return Response({
            'academic_year': int(academic_year_id),
            'month': month,
            'class_obj': int(class_obj_id) if class_obj_id else None,
            'session_class': int(session_class_id) if session_class_id else None,
            'count': len(results),
            'results': results,
        })


class StudentTermAssessmentBulkSaveView(ModuleAccessMixin, APIView):
    """
    Bulk upsert student assessments for a selected class + month.
    POST {
      academic_year, month, session_class|class_obj,
      assessments: [{student, ...rating_fields, teacher_remark, principal_remark}]
    }
    """
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, CanManageStudentAssessments, HasSchoolAccess]

    RATING_FIELDS = StudentTermAssessmentView.RATING_FIELDS

    def post(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        academic_year_id = request.data.get('academic_year')
        month = StudentTermAssessmentView._parse_month(request.data.get('month'))
        session_class_id = request.data.get('session_class')
        class_obj_id = request.data.get('class_obj')
        rows = request.data.get('assessments') or []

        if not academic_year_id or month is None:
            return Response({'error': 'academic_year and month (1-12) are required'}, status=400)
        if not session_class_id and not class_obj_id:
            return Response({'error': 'session_class or class_obj is required'}, status=400)
        if not isinstance(rows, list):
            return Response({'error': 'assessments must be a list'}, status=400)

        if not StudentTermAssessmentView()._teacher_can_access_class(
            request,
            school_id,
            academic_year_id,
            class_obj_id=class_obj_id,
            session_class_id=session_class_id,
        ):
            return Response({'detail': 'You are not assigned to this class for the selected academic year.'}, status=403)

        from academic_sessions.models import StudentEnrollment

        enrollments = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            is_active=True,
        )
        if session_class_id:
            enrollments = enrollments.filter(session_class_id=session_class_id)
        else:
            enrollments = enrollments.filter(class_obj_id=class_obj_id)

        allowed_student_ids = set(enrollments.values_list('student_id', flat=True))
        if not allowed_student_ids:
            return Response({
                'error': 'No active enrollments found for selected class and academic year',
            }, status=400)

        created = 0
        updated = 0
        errors = []
        saved_results = []

        existing_map = {
            row.student_id: row
            for row in StudentTermAssessment.objects.filter(
                school_id=school_id,
                academic_year_id=academic_year_id,
                month=month,
                student_id__in=allowed_student_ids,
            )
        }

        with transaction.atomic():
            for index, row in enumerate(rows):
                student_id = row.get('student')
                if not student_id:
                    errors.append({'index': index, 'error': 'student is required'})
                    continue
                if student_id not in allowed_student_ids:
                    errors.append({
                        'index': index,
                        'student': student_id,
                        'error': 'student is not enrolled in selected class/academic_year',
                    })
                    continue

                defaults = StudentTermAssessmentView()._build_defaults(request, row, existing=existing_map.get(student_id))

                obj, was_created = StudentTermAssessment.objects.update_or_create(
                    school_id=school_id,
                    student_id=student_id,
                    academic_year_id=academic_year_id,
                    month=month,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

                payload = StudentTermAssessmentSerializer(obj).data
                payload['exists'] = True
                saved_results.append(payload)

        return Response({
            'academic_year': int(academic_year_id),
            'month': month,
            'class_obj': int(class_obj_id) if class_obj_id else None,
            'session_class': int(session_class_id) if session_class_id else None,
            'submitted_count': len(rows),
            'created': created,
            'updated': updated,
            'error_count': len(errors),
            'errors': errors,
            'results': saved_results,
        })


class StudentTermAssessmentAIRemarkView(ModuleAccessMixin, APIView):
    """
    Draft a teacher/principal remark from a student's current skill/behaviour ratings.
    POST {ratings: {field_label: rating_value(1-5)}, remark_type: 'teacher'|'principal'} -> {remark, fallback}
    """
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, CanManageStudentAssessments, HasSchoolAccess]

    def post(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        ratings = request.data.get('ratings')
        remark_type = request.data.get('remark_type') or 'teacher'
        if not isinstance(ratings, dict):
            return Response({'error': 'ratings (object) is required'}, status=400)
        if remark_type not in ('teacher', 'principal'):
            return Response({'error': "remark_type must be 'teacher' or 'principal'"}, status=400)

        from .ai_comments_service import generate_term_assessment_remark

        from schools.models import School
        remark, fallback = generate_term_assessment_remark(
            ratings, remark_type=remark_type,
            school=School.objects.filter(id=school_id).first(),
            other_remark=request.data.get('teacher_remark') or '',
        )
        if remark is None:
            return Response(
                {'error': 'Rate at least one skill or behaviour before requesting an AI suggestion.'},
                status=400,
            )
        return Response({'remark': remark, 'fallback': fallback})


REPORT_CARD_MAX_EXAMS = 4


def _exam_sort_key(exam):
    """Oldest -> newest; the last exam is a report card's main exam."""
    return (exam.end_date or exam.start_date or date.min, exam.start_date or date.min, exam.id)


def _parse_exam_ids(value):
    if value in (None, ''):
        return []
    if isinstance(value, str):
        value = [x for x in value.split(',') if x.strip()]
    return list(value)


def _report_exams_for(school_id, class_obj_id, year_id, exam_ids, published_only=False,
                      session_class_id=None):
    """The exams on one report card, oldest first, validated against the student's class
    and year. The last one is the main exam. Raises ValidationError on anything invalid.
    With session_class_id, a sibling section's section-only exams are not available."""
    try:
        ids = sorted({int(x) for x in exam_ids})
    except (TypeError, ValueError):
        raise ValidationError({'exam_ids': 'Must be a list of exam ids.'})
    if not ids:
        raise ValidationError({'exam_ids': 'Pick at least one exam.'})
    if len(ids) > REPORT_CARD_MAX_EXAMS:
        raise ValidationError({'exam_ids': f'A report card can combine at most {REPORT_CARD_MAX_EXAMS} exams.'})
    qs = Exam.objects.filter(
        school_id=school_id, class_obj_id=class_obj_id, academic_year_id=year_id,
        is_active=True, pk__in=ids,
    ).select_related('exam_type', 'academic_year', 'term')
    if session_class_id:
        qs = qs.filter(Q(session_class__isnull=True) | Q(session_class_id=session_class_id))
    if published_only:
        qs = qs.filter(status=Exam.Status.PUBLISHED)
    found = sorted(qs, key=_exam_sort_key)
    if len(found) != len(ids):
        raise ValidationError({'exam_ids': 'One or more exams are not available for this student.'})
    return found


class ReportCardView(ModuleAccessMixin, APIView):
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    @staticmethod
    def _months_in_range(start_date, end_date):
        """Calendar month numbers spanned by [start_date, end_date], in chronological
        order (duplicates if the range exceeds 12 months, which we don't expect here)."""
        months = []
        cur = date(start_date.year, start_date.month, 1)
        end = date(end_date.year, end_date.month, 1)
        while cur <= end:
            months.append(cur.month)
            cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
        return months

    # The 12 fields a teacher rates on the Assessments page (1-5 stars each),
    # grouped the same way that page groups them.
    ASSESSMENT_SKILL_FIELDS = [
        ('listening', 'Listening'), ('speaking', 'Speaking'), ('writing', 'Writing'),
        ('reading', 'Reading'), ('participation', 'Participation'), ('confidence', 'Confidence'),
        ('social_skills', 'Social Skills'),
    ]
    ASSESSMENT_BEHAVIOUR_FIELDS = [
        ('discipline', 'Discipline'), ('respect', 'Respect'), ('teamwork', 'Teamwork'),
        ('class_participation', 'Class Participation'), ('responsibility', 'Responsibility'),
    ]

    @staticmethod
    def _compute_overall_stats(student_id, exams, es_by_exam, marks_by_key, weighted):
        """A student's result on this card, keyed so it can run once per classmate for
        ranking as well as for the report's own student. `exams` is oldest -> newest and
        the last one is the main exam.

        Not weighted: the main exam alone. Weighted: earlier exams count too, each by its
        exam-type weight (normalised over the exams the student actually has marks for).
        obtained/possible are always the main exam's; only percentage blends."""
        main = exams[-1]

        def exam_totals(exam):
            obtained, possible, has_marks = Decimal('0'), Decimal('0'), False
            for es_item in es_by_exam.get(exam.id, []):
                mark = marks_by_key.get((student_id, es_item.id))
                if mark is not None:
                    has_marks = True
                if mark and mark.marks_obtained is not None and not mark.is_absent:
                    obtained += mark.marks_obtained
                possible += es_item.total_marks
            return obtained, possible, has_marks

        main_obtained, main_possible, _ = exam_totals(main)
        if not weighted:
            if main_possible <= 0:
                return None
            return {
                'obtained': float(main_obtained), 'possible': float(main_possible),
                'percentage': float(main_obtained / main_possible * 100),
            }

        weighted_sum, total_weight = Decimal('0'), Decimal('0')
        for exam in exams:
            obtained, possible, has_marks = exam_totals(exam)
            if not has_marks or possible <= 0:
                continue
            weight = exam.exam_type.weight
            weighted_sum += (obtained / possible * 100) * weight
            total_weight += weight
        if total_weight <= 0:
            return None
        return {
            'obtained': float(main_obtained), 'possible': float(main_possible),
            'percentage': float(weighted_sum / total_weight),
        }

    @staticmethod
    def _subject_result_pct(student_id, subj_id, exams, es_by_exam, marks_by_key, weighted):
        """One subject's result %: the main exam's, or (weighted) the exam-type-weighted
        blend across the exams where the student has a mark row for that subject."""

        def pct_for(exam):
            for es_item in es_by_exam.get(exam.id, []):
                if es_item.subject_id == subj_id:
                    mark = marks_by_key.get((student_id, es_item.id))
                    got = mark.marks_obtained if mark and mark.marks_obtained is not None and not mark.is_absent else Decimal('0')
                    return mark is not None, (got / es_item.total_marks * 100) if es_item.total_marks > 0 else None
            return False, None

        if not weighted:
            _, pct = pct_for(exams[-1])
            return float(pct) if pct is not None else None
        weighted_sum, total_weight = Decimal('0'), Decimal('0')
        for exam in exams:
            has_mark, pct = pct_for(exam)
            if not has_mark or pct is None:
                continue
            weighted_sum += pct * exam.exam_type.weight
            total_weight += exam.exam_type.weight
        return float(weighted_sum / total_weight) if total_weight > 0 else None

    @staticmethod
    def _print_details(student, enrollment, main_exam):
        """Promotion status + hand-set print details for this report. Both follow the
        main exam: promotion only applies when it is a final exam type (otherwise it is
        always NOT_APPLICABLE and the card hides it)."""
        applicable = bool(main_exam and main_exam.exam_type.is_final)
        promotion = ReportCardPromotion.objects.filter(
            student=student, academic_year_id=enrollment.academic_year_id,
        ).first() if applicable else None
        override = ReportCardOverride.objects.filter(student=student, exam=main_exam).first() if main_exam else None
        return {
            'promotion_applicable': applicable,
            'promotion_status': promotion.status if promotion else ReportCardPromotion.Status.NOT_APPLICABLE,
            'issue_date': override.issue_date.isoformat() if override and override.issue_date else None,
            'signature_labels': override.signature_labels if override else {},
        }

    def get(self, request):
        student_id = request.query_params.get('student_id')
        academic_year_id = request.query_params.get('academic_year_id')
        term_id = request.query_params.get('term_id')
        enrollment_id = request.query_params.get('enrollment_id')

        if not student_id:
            return Response({'detail': 'student_id required.'}, status=400)
        if not academic_year_id and not enrollment_id:
            return Response(
                {'detail': 'academic_year_id or enrollment_id is required.'},
                status=400,
            )

        school_id = _resolve_school_id(request)

        from students.models import Student
        from academic_sessions.models import StudentEnrollment
        try:
            student = Student.objects.select_related('class_obj', 'school').get(
                pk=student_id, school_id=school_id,
            )
        except Student.DoesNotExist:
            return Response({'detail': 'Student not found.'}, status=404)

        enrollment_qs = StudentEnrollment.objects.select_related('class_obj', 'academic_year', 'session_class').filter(
            school_id=school_id,
            student_id=student.id,
        )
        if enrollment_id:
            enrollment_qs = enrollment_qs.filter(pk=enrollment_id)
        else:
            enrollment_qs = enrollment_qs.filter(academic_year_id=academic_year_id)

        enrollment = enrollment_qs.order_by('-created_at').first()
        if not enrollment:
            return Response(
                {'detail': 'No enrollment found for the selected student/session.'},
                status=404,
            )

        # Exams on this card, oldest first. The last is the main exam: it alone drives
        # totals, position and everything else printed as a result; earlier ones are shown
        # as history (unless weighting is on, which blends them). Without exam_ids the card
        # is the latest exam only (of term_id when given) - never a combination.
        # Staff can preview marks before results are announced (flagged is_draft below);
        # any other role only ever sees announced results.
        from users.models import User as _User
        staff_roles = {
            _User.Role.SUPER_ADMIN, _User.Role.SCHOOL_ADMIN, _User.Role.PRINCIPAL,
            _User.Role.MANAGER, _User.Role.TEACHER, _User.Role.STAFF,
        }
        published_only = request.user.role not in staff_roles
        raw_exam_ids = _parse_exam_ids(request.query_params.get('exam_ids'))
        if raw_exam_ids:
            exams = _report_exams_for(
                school_id, enrollment.class_obj_id, enrollment.academic_year_id, raw_exam_ids, published_only,
                session_class_id=enrollment.session_class_id,
            )
        else:
            fallback = Exam.objects.filter(
                school_id=school_id, class_obj=enrollment.class_obj, is_active=True,
                academic_year_id=enrollment.academic_year_id,
            ).filter(
                Q(session_class__isnull=True) | Q(session_class_id=enrollment.session_class_id)
            ).select_related('exam_type', 'academic_year', 'term')
            if published_only:
                fallback = fallback.filter(status=Exam.Status.PUBLISHED)
            if term_id:
                fallback = fallback.filter(term_id=term_id)
            exams = sorted(fallback, key=_exam_sort_key)[-1:]
        main_exam = exams[-1] if exams else None

        grade_scales = list(GradeScale.objects.filter(
            school_id=school_id, is_active=True,
        ).order_by('-min_percentage'))

        # Prefetch all exam subjects and marks for this student in one query
        all_exam_subjects = ExamSubject.objects.filter(
            exam__in=exams, is_active=True,
        ).select_related('subject')
        student_marks = StudentMark.objects.filter(
            exam_subject__in=all_exam_subjects,
            student=student,
            school_id=school_id,
        )
        marks_lookup = {m.exam_subject_id: m for m in student_marks}

        # Group exam subjects by exam
        es_by_exam = {}
        for es in all_exam_subjects:
            es_by_exam.setdefault(es.exam_id, []).append(es)

        all_subjects = {}
        exam_data = []

        for exam in exams:
            exam_subjects = es_by_exam.get(exam.id, [])
            exam_marks = {}

            for es in exam_subjects:
                if es.subject_id not in all_subjects:
                    all_subjects[es.subject_id] = es.subject.name

                mark = marks_lookup.get(es.id)
                exam_marks[es.subject_id] = {
                    'total_marks': float(es.total_marks),
                    'marks_obtained': float(mark.marks_obtained) if mark and mark.marks_obtained is not None else None,
                    'is_absent': mark.is_absent if mark else False,
                    'ai_comment': mark.ai_comment if mark else '',
                }

            exam_data.append({
                'exam_id': exam.id,
                'exam_name': exam.name,
                'exam_type': exam.exam_type.name,
                'term': exam.term.name if exam.term else None,
                'weight': float(exam.exam_type.weight),
                'is_main': exam.id == main_exam.id,
                'end_date': (exam.end_date or exam.start_date).isoformat() if (exam.end_date or exam.start_date) else None,
                'marks': exam_marks,
            })

        # Determine weighted vs simple calculation
        from schools.models import School
        school = School.objects.get(pk=school_id)
        use_weighted = (school.exam_config or {}).get('weighted_average_enabled', False)
        # A single exam is always just that exam; only a multi-exam card can blend.
        weighted_calc = use_weighted and len(exams) > 1

        # Rank and class average are among the student's own section.
        class_students, _roll_by_student = _class_roster(
            school_id, enrollment.class_obj_id, enrollment.academic_year_id,
            as_of_date=(main_exam.start_date or main_exam.end_date) if main_exam else None,
            session_class_id=enrollment.session_class_id,
        )
        class_marks = StudentMark.objects.filter(exam_subject__in=all_exam_subjects, school_id=school_id)
        marks_by_key = {(m.student_id, m.exam_subject_id): m for m in class_marks}

        own_stats = self._compute_overall_stats(student.id, exams, es_by_exam, marks_by_key, weighted_calc) if exams else None
        grand_total_obtained = Decimal(str(own_stats['obtained'])) if own_stats else Decimal('0')
        grand_total_possible = Decimal(str(own_stats['possible'])) if own_stats else Decimal('0')
        overall_pct = own_stats['percentage'] if own_stats else 0

        overall_grade = '-'
        for gs in grade_scales:
            if float(gs.min_percentage) <= overall_pct <= float(gs.max_percentage):
                overall_grade = gs.grade_label
                break

        # Subject rows come from the main exam; earlier exams only add their columns
        # (exam_data above). Pass/fail is the main exam's own criteria.
        main_es_by_subject = {es.subject_id: es for es in es_by_exam.get(main_exam.id, [])} if main_exam else {}
        subject_summaries = []
        for subj_id, es_item in main_es_by_subject.items():
            mark = marks_lookup.get(es_item.id)
            subj_obtained = Decimal('0')
            subj_absent = False
            subj_pass = True
            if mark and mark.marks_obtained is not None and not mark.is_absent:
                subj_obtained = mark.marks_obtained
                if mark.marks_obtained < es_item.passing_marks:
                    subj_pass = False
            else:
                subj_pass = False
                if mark and mark.is_absent:
                    subj_absent = True

            subj_pct = self._subject_result_pct(student.id, subj_id, exams, es_by_exam, marks_by_key, weighted_calc) or 0
            subj_grade = '-'
            for gs in grade_scales:
                if float(gs.min_percentage) <= subj_pct <= float(gs.max_percentage):
                    subj_grade = gs.grade_label
                    break

            # Class average: of the main exam's marks, or (weighted) of classmates' blended %.
            # A missing/absent mark isn't a zero - it would drag the average down.
            values = []
            for classmate in class_students:
                if weighted_calc:
                    value = self._subject_result_pct(classmate.id, subj_id, exams, es_by_exam, marks_by_key, True)
                else:
                    cm = marks_by_key.get((classmate.id, es_item.id))
                    value = float(cm.marks_obtained) if cm and cm.marks_obtained is not None and not cm.is_absent else None
                if value is not None:
                    values.append(value)

            subject_summaries.append({
                'subject_id': subj_id,
                'comment_exam_id': main_exam.id,
                'subject_name': all_subjects[subj_id],
                'total_marks': float(es_item.total_marks),
                'marks_obtained': float(subj_obtained),
                'percentage': round(subj_pct, 2),
                'grade': subj_grade,
                'is_pass': subj_pass,
                'is_absent': subj_absent,
                'comment': mark.ai_comment if mark and mark.ai_comment else '',
                'class_avg': round(sum(values) / len(values), 2) if values else None,
            })

        overall_comment_row = StudentExamComment.objects.filter(
            exam=main_exam, student=student, school_id=school_id,
        ).exclude(comment='').order_by('-updated_at').first() if main_exam else None

        from academic_sessions.utils import resolve_class_display_name, resolve_current_academic_year_id

        enrollment_class_name = (
            enrollment.session_class.display_name
            if enrollment.session_class_id and enrollment.session_class.display_name
            else enrollment.class_obj.name
        )
        current_class_name = resolve_class_display_name(
            school_id, resolve_current_academic_year_id(school_id), student.class_obj,
        )

        # The card is named after its main exam; everything term-scoped (attendance,
        # assessments) follows that exam's term.
        report_term = main_exam.term if main_exam and main_exam.term else None
        if not report_term and term_id:
            from academic_sessions.models import Term
            report_term = Term.objects.filter(pk=term_id, school_id=school_id).first()

        exam_names = [e.name for e in exams]
        exam_display = main_exam.name if main_exam else None

        # Attendance and the monthly teacher assessment are both scoped to this term's
        # date range (or the whole academic year when no term filter was given).
        if report_term:
            period_start, period_end = report_term.start_date, report_term.end_date
        else:
            period_start, period_end = enrollment.academic_year.start_date, enrollment.academic_year.end_date

        # Working days exclude Sundays and student-affecting OFF_DAY calendar entries,
        # and stop at today so an in-progress term doesn't count future days as unmarked.
        from attendance.models import AttendanceRecord
        from academic_sessions.calendar_rules import build_student_off_day_set
        from .term_periods import attendance_period
        # Assessments keep the wider whole-term window: a term stored as just its exam
        # window would otherwise hide assessments entered in earlier months.
        assess_start, assess_end = attendance_period(school_id, report_term, enrollment.academic_year)
        # Attendance itself is strictly the term(s)/month of the ticked exams.
        period_start_att, period_end_att = _report_attendance_window(exams, enrollment.academic_year)
        attendance = None
        if period_start_att and period_end_att:
            attendance = attendance_summaries(
                school_id, [student.id], period_start_att, period_end_att,
                enrollment.class_obj_id,
            ).get(student.id)

        # Position (rank): the same calculation run for every other student in this
        # class - not a filtered subset - so the student with the highest result is
        # Position 1. Not weighted: the main exam's total marks. Weighted: the blended %
        # (raw sums aren't comparable across differently-weighted exams).
        is_weighted_calc = weighted_calc
        class_stats = []
        for classmate in class_students if exams else []:
            stats = self._compute_overall_stats(classmate.id, exams, es_by_exam, marks_by_key, weighted_calc)
            if stats is not None:
                class_stats.append((classmate.id, stats))

        def _rank_key(stats):
            return round(stats['percentage'] if is_weighted_calc else stats['obtained'], 2)

        class_stats.sort(key=lambda item: _rank_key(item[1]), reverse=True)
        # Dense ranking: tied students share a position and the next score is +1 (1,1,1,2).
        rank = None
        class_size = len(class_stats)
        current_rank, prev_key = 0, None
        for sid, stats in class_stats:
            key = _rank_key(stats)
            if key != prev_key:
                current_rank += 1
                prev_key = key
            if sid == student.id:
                rank = current_rank
                break

        # Latest teacher-entered assessment (conduct ratings + remarks) whose month
        # falls inside this term - per product decision, "latest" wins over averaging.
        # Same whole-term window as attendance: a term stored as just its exam window
        # (e.g. 14-22 Sept) would otherwise hide assessments entered for earlier months.
        term_months = self._months_in_range(assess_start or period_start, assess_end or period_end)
        assessments = list(StudentTermAssessment.objects.filter(
            school_id=school_id, student=student, academic_year_id=enrollment.academic_year_id,
            month__in=term_months,
        ))
        latest_assessment = None
        if assessments:
            month_order = {m: i for i, m in enumerate(term_months)}
            latest_assessment = max(assessments, key=lambda a: month_order.get(a.month, -1))

        conduct_assessment = None
        if latest_assessment:
            rating_labels = dict(StudentTermAssessment.Rating.choices)

            def _ratings(fields):
                return [
                    {
                        'field': field,
                        'label': label,
                        'rating': getattr(latest_assessment, field),
                        'rating_label': rating_labels.get(getattr(latest_assessment, field)),
                    }
                    for field, label in fields
                ]

            conduct_assessment = {
                'month': latest_assessment.month,
                'skills': _ratings(self.ASSESSMENT_SKILL_FIELDS),
                'behaviour': _ratings(self.ASSESSMENT_BEHAVIOUR_FIELDS),
                'teacher_remark': latest_assessment.teacher_remark,
                'principal_remark': latest_assessment.principal_remark,
            }

        return Response({
            'student_name': student.name,
            'roll_number': enrollment.roll_number or student.roll_number,
            'class_name': enrollment_class_name,
            'school_name': student.school.name,
            'academic_year_name': enrollment.academic_year.name,
            'term_name': report_term.name if report_term else None,
            'exam_display': exam_display,
            'exam_names': exam_names,
            'exam_ids': [e.id for e in exams],
            'main_exam': {
                'id': main_exam.id, 'name': main_exam.name, 'exam_type': main_exam.exam_type.name,
                'is_final': main_exam.exam_type.is_final,
            } if main_exam else None,
            'earlier_exam_names': exam_names[:-1],
            'weighted': weighted_calc,
            'class_avg_unit': 'percent' if weighted_calc else 'marks',
            'is_draft': any(e.status != Exam.Status.PUBLISHED for e in exams),
            'guardian_name': student.guardian_name or student.parent_name or '',
            'photo_url': student.photo_url or '',
            'attendance': attendance,
            'class_size': class_size,
            'conduct_assessment': conduct_assessment,
            **self._print_details(student, enrollment, main_exam),
            'enrollment_info': {
                'enrollment_id': enrollment.id,
                'class_at_report_session': enrollment_class_name,
                'current_class': current_class_name,
                'academic_year_id': enrollment.academic_year_id,
                'academic_year_name': enrollment.academic_year.name,
            },
            'student': {
                'id': student.id,
                'name': student.name,
                'roll_number': enrollment.roll_number or student.roll_number,
                'class_name': enrollment_class_name,
                'school_name': student.school.name,
            },
            'subjects': subject_summaries,
            'overall_comment': overall_comment_row.comment if overall_comment_row else '',
            'overall_comment_exam_id': main_exam.id if main_exam else None,
            'exams': exam_data,
            'summary': {
                'total_marks': float(grand_total_possible),
                'obtained_marks': float(grand_total_obtained),
                'total_obtained': float(grand_total_obtained),
                'total_possible': float(grand_total_possible),
                'percentage': round(overall_pct, 2),
                'grade': overall_grade,
                'rank': rank,
                'overall_pass': all(s['is_pass'] for s in subject_summaries) if subject_summaries else False,
                'calculation_mode': 'weighted' if weighted_calc else ('main_only' if len(exams) > 1 else 'simple'),
            },
            'grade_scales': [
                {
                    'grade_label': gs.grade_label,
                    'min_percentage': float(gs.min_percentage),
                    'max_percentage': float(gs.max_percentage),
                    'gpa_points': float(gs.gpa_points),
                }
                for gs in grade_scales
            ],
        })


class ReportCardMetaView(ModuleAccessMixin, APIView):
    """Saves the hand-editable parts of a report card: promotion status (final exams
    only), issue date and signature captions. All of it belongs to the card's main
    (last) exam, so exam_ids is required. Admins/managers edit within their school; a
    teacher only for students in a class they are class teacher of."""
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    SIGNATURE_KEYS = ('class_teacher', 'principal', 'parent')

    def post(self, request):
        from students.models import Student
        from academic_sessions.models import StudentEnrollment
        from datetime import date as _date

        school_id = _resolve_school_id(request)
        data = request.data
        student_id, year_id = data.get('student_id'), data.get('academic_year_id')
        if not student_id or not year_id:
            raise ValidationError({'detail': 'student_id and academic_year_id are required.'})

        student = Student.objects.filter(pk=student_id, school_id=school_id).first()
        if not student:
            return Response({'detail': 'Student not found.'}, status=404)
        enrollment = StudentEnrollment.objects.filter(
            school_id=school_id, student=student, academic_year_id=year_id,
        ).order_by('-created_at').first()
        if not enrollment:
            return Response({'detail': 'No enrollment found for that student and year.'}, status=404)

        role = get_effective_role(request)
        allowed = role in ADMIN_ROLES or role == 'MANAGER' or (
            role == 'TEACHER'
            and _is_teacher_class_teacher_for_class(request, enrollment.class_obj_id, school_id=school_id)
        )
        if not allowed:
            raise PermissionDenied('Only admins or the class teacher can edit report card details.')

        main_exam = _report_exams_for(
            school_id, enrollment.class_obj_id, year_id, _parse_exam_ids(data.get('exam_ids')),
            session_class_id=enrollment.session_class_id,
        )[-1]

        with transaction.atomic():
            if 'promotion_status' in data:
                new_status = data['promotion_status']
                if new_status not in ReportCardPromotion.Status.values:
                    raise ValidationError({'promotion_status': 'Invalid status.'})
                if not main_exam.exam_type.is_final and new_status != ReportCardPromotion.Status.NOT_APPLICABLE:
                    raise ValidationError({'promotion_status': 'Promotion can only be set for a final exam.'})
                ReportCardPromotion.objects.update_or_create(
                    student=student, academic_year_id=year_id,
                    defaults={'school_id': school_id, 'status': new_status, 'updated_by': request.user},
                )

            if 'issue_date' in data or 'signature_labels' in data:
                override = ReportCardOverride.objects.filter(student=student, exam=main_exam).first() or ReportCardOverride(
                    school_id=school_id, student=student, academic_year_id=year_id, exam=main_exam,
                )
                if 'issue_date' in data:
                    raw = data['issue_date']
                    try:
                        override.issue_date = _date.fromisoformat(raw) if raw else None
                    except (TypeError, ValueError):
                        raise ValidationError({'issue_date': 'Use YYYY-MM-DD.'})
                if 'signature_labels' in data:
                    labels = data['signature_labels'] or {}
                    if not isinstance(labels, dict):
                        raise ValidationError({'signature_labels': 'Must be an object.'})
                    override.signature_labels = {
                        k: str(labels[k]).strip()[:40] for k in self.SIGNATURE_KEYS if labels.get(k)
                    }
                override.updated_by = request.user
                override.save()
        return Response({'saved': True})


class ReportCardBulkMetaView(ModuleAccessMixin, APIView):
    """Class-level version of ReportCardMetaView: promotion per student plus one issue date
    and one set of signature captions applied to many students in a single save.

    Takes explicit student_ids (the page already lists the class roster) and exam_ids
    (the card's exams; the last is the main exam everything is stored against). Exams
    belong to one class, so every student must be enrolled in that class. Authorisation
    is checked against each student's own enrollment class, like the single endpoint."""
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    MAX_STUDENTS = 200

    def _load(self, request, school_id, year_id, student_ids, exam_ids):
        from academic_sessions.models import StudentEnrollment
        if not year_id or not student_ids:
            raise ValidationError({'detail': 'academic_year_id and student_ids are required.'})
        try:
            student_ids = sorted({int(x) for x in student_ids})
        except (TypeError, ValueError):
            raise ValidationError({'student_ids': 'Must be a list of ids.'})
        if len(student_ids) > self.MAX_STUDENTS:
            raise ValidationError({'student_ids': f'At most {self.MAX_STUDENTS} students per request.'})

        enrollments = {}
        for e in StudentEnrollment.objects.filter(
            school_id=school_id, academic_year_id=year_id, student_id__in=student_ids,
        ).order_by('created_at'):
            enrollments[e.student_id] = e
        missing = [sid for sid in student_ids if sid not in enrollments]
        if missing:
            raise ValidationError({'student_ids': f'No enrollment for students: {missing[:5]}.'})

        class_ids = {e.class_obj_id for e in enrollments.values()}
        if len(class_ids) != 1:
            raise ValidationError({'student_ids': 'Bulk edit works on one class at a time.'})
        class_id = next(iter(class_ids))

        role = get_effective_role(request)
        if not (role in ADMIN_ROLES or role == 'MANAGER'):
            if role != 'TEACHER' or not _is_teacher_class_teacher_for_class(request, class_id, school_id=school_id):
                raise PermissionDenied('Only admins or the class teacher can edit report card details.')

        section_ids = {e.session_class_id for e in enrollments.values()}
        main_exam = _report_exams_for(
            school_id, class_id, year_id, _parse_exam_ids(exam_ids),
            session_class_id=next(iter(section_ids)) if len(section_ids) == 1 else None,
        )[-1]
        return student_ids, enrollments, main_exam

    def get(self, request):
        school_id = _resolve_school_id(request)
        year_id = request.query_params.get('academic_year_id')
        raw_ids = [x for x in (request.query_params.get('student_ids') or '').split(',') if x]
        student_ids, enrollments, main_exam = self._load(
            request, school_id, year_id, raw_ids, request.query_params.get('exam_ids'),
        )
        promotions = dict(ReportCardPromotion.objects.filter(
            academic_year_id=year_id, student_id__in=student_ids,
        ).values_list('student_id', 'status'))
        issue_dates = dict(ReportCardOverride.objects.filter(
            exam=main_exam, student_id__in=student_ids,
        ).values_list('student_id', 'issue_date'))
        applicable = main_exam.exam_type.is_final
        return Response({
            'main_exam': {'id': main_exam.id, 'name': main_exam.name},
            'students': {
                str(sid): {
                    'promotion_applicable': applicable,
                    'promotion_status': promotions.get(sid, ReportCardPromotion.Status.NOT_APPLICABLE),
                    'issue_date': issue_dates[sid].isoformat() if issue_dates.get(sid) else None,
                }
                for sid in student_ids
            },
        })

    def post(self, request):
        from datetime import date as _date
        school_id = _resolve_school_id(request)
        data = request.data
        year_id = data.get('academic_year_id')
        student_ids, enrollments, main_exam = self._load(
            request, school_id, year_id, data.get('student_ids'), data.get('exam_ids'),
        )

        promotions = data.get('promotions') or {}
        if not isinstance(promotions, dict):
            raise ValidationError({'promotions': 'Must be an object of student_id -> status.'})
        for status_value in promotions.values():
            if status_value not in ReportCardPromotion.Status.values:
                raise ValidationError({'promotions': 'Invalid status.'})

        issue_date = None
        if data.get('issue_date'):
            try:
                issue_date = _date.fromisoformat(data['issue_date'])
            except (TypeError, ValueError):
                raise ValidationError({'issue_date': 'Use YYYY-MM-DD.'})

        labels = None
        if data.get('signature_labels'):
            raw = data['signature_labels']
            if not isinstance(raw, dict):
                raise ValidationError({'signature_labels': 'Must be an object.'})
            labels = {k: str(raw[k]).strip()[:40] for k in ReportCardMetaView.SIGNATURE_KEYS if raw.get(k)}

        # overwrite=False only fills students that have nothing set yet.
        overwrite = data.get('overwrite', True) is not False
        is_final = main_exam.exam_type.is_final

        with transaction.atomic():
            for sid_raw, status_value in promotions.items():
                sid = int(sid_raw)
                if sid not in enrollments:
                    raise ValidationError({'promotions': f'Student {sid} is not in this request.'})
                if status_value != ReportCardPromotion.Status.NOT_APPLICABLE and not is_final:
                    raise ValidationError({'promotions': 'Promotion can only be set for a final exam.'})
                existing = ReportCardPromotion.objects.filter(student_id=sid, academic_year_id=year_id).first()
                if existing and not overwrite and existing.status != ReportCardPromotion.Status.NOT_APPLICABLE:
                    continue
                ReportCardPromotion.objects.update_or_create(
                    student_id=sid, academic_year_id=year_id,
                    defaults={'school_id': school_id, 'status': status_value, 'updated_by': request.user},
                )

            if issue_date or labels:
                for sid in student_ids:
                    override = ReportCardOverride.objects.filter(student_id=sid, exam=main_exam).first() or ReportCardOverride(
                        school_id=school_id, student_id=sid, academic_year_id=year_id, exam=main_exam,
                    )
                    if issue_date and (overwrite or not override.issue_date):
                        override.issue_date = issue_date
                    if labels:
                        merged = dict(override.signature_labels or {})
                        for key, value in labels.items():
                            if overwrite or key not in merged:
                                merged[key] = value
                        override.signature_labels = merged
                    override.updated_by = request.user
                    override.save()
        return Response({'saved': True, 'students': len(student_ids)})


# ===========================================
# Question Paper Builder ViewSets
# ===========================================


class QuestionViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """ViewSet for Question management."""
    required_module = 'examinations'
    queryset = Question.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return QuestionCreateUpdateSerializer
        return QuestionSerializer

    def get_queryset(self):
        qs = super().get_queryset()

        scope = resolve_class_scope(
            self.request,
            school_id=_resolve_school_id(self.request),
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return qs.none()

        class_id = scope['class_obj_id']
        chapter_id = self.request.query_params.get('chapter_id')
        book_id = self.request.query_params.get('book_id')

        if get_effective_role(self.request) == 'TEACHER':
            school_id = _resolve_school_id(self.request)
            class_subject_map = _get_teacher_class_subject_map(self.request, school_id=school_id)
            if class_id:
                allowed_subject_ids = class_subject_map.get(class_id, set())
            else:
                allowed_subject_ids = _get_teacher_allowed_subject_ids(self.request, school_id=school_id)
            if not allowed_subject_ids:
                return qs.none()
            qs = qs.filter(subject_id__in=allowed_subject_ids)

            if class_id and class_id not in class_subject_map:
                return qs.none()

        if class_id:
            qs = qs.filter(tested_topics__chapter__book__class_obj_id=class_id)
        
        # Filter by subject
        subject_id = self.request.query_params.get('subject')
        if subject_id:
            qs = qs.filter(subject_id=subject_id)

        if book_id:
            qs = qs.filter(tested_topics__chapter__book_id=book_id)

        if chapter_id:
            qs = qs.filter(tested_topics__chapter_id=chapter_id)
        
        # Filter by exam type
        exam_type_id = self.request.query_params.get('exam_type')
        if exam_type_id:
            qs = qs.filter(exam_type_id=exam_type_id)
        
        # Filter by question type
        question_type = self.request.query_params.get('question_type')
        if question_type:
            qs = qs.filter(question_type=question_type)
        
        # Filter by difficulty
        difficulty = self.request.query_params.get('difficulty') or self.request.query_params.get('difficulty_level')
        if difficulty:
            qs = qs.filter(difficulty_level=difficulty)

        bloom_level = self.request.query_params.get('bloom_level')
        if bloom_level:
            qs = qs.filter(bloom_level=bloom_level)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        
        # Search by question text
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(question_text__icontains=search)

        topic_id = self.request.query_params.get('topic_id')
        if topic_id:
            qs = qs.filter(tested_topics__id=topic_id).distinct()

        topic_ids = self.request.query_params.getlist('topics')
        if topic_ids:
            qs = qs.filter(tested_topics__id__in=topic_ids).distinct()

        tag_id = self.request.query_params.get('tag_id')
        if tag_id:
            qs = qs.filter(question_tags__tag_id=tag_id).distinct()

        ordering = self.request.query_params.get('ordering')
        if ordering in {'paper_use_count', '-paper_use_count'}:
            qs = qs.order_by(ordering, 'id')

        if class_id or book_id or chapter_id:
            qs = qs.distinct()

        return qs.select_related('subject', 'exam_type', 'created_by', 'stats')

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if get_effective_role(self.request) == 'TEACHER':
            subject = serializer.validated_data.get('subject')
            allowed_subject_ids = _get_teacher_allowed_subject_ids(self.request, school_id=school_id)
            if not subject or subject.id not in allowed_subject_ids:
                raise PermissionDenied('You can only create questions for your assigned subjects.')
        serializer.save(school_id=school_id, created_by=self.request.user)

    def perform_update(self, serializer):
        school_id = _resolve_school_id(self.request)
        if get_effective_role(self.request) == 'TEACHER':
            subject = serializer.validated_data.get('subject', serializer.instance.subject)
            allowed_subject_ids = _get_teacher_allowed_subject_ids(self.request, school_id=school_id)
            if not subject or subject.id not in allowed_subject_ids:
                raise PermissionDenied('You can only edit questions for your assigned subjects.')
        serializer.instance._revision_changed_by = self.request.user
        serializer.save()

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=True, methods=['post'], url_path='add_tag')
    def add_tag(self, request, pk=None):
        question = self.get_object()
        tag_id = request.data.get('tag_id')
        if not tag_id:
            return Response({'detail': 'tag_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tag = Tag.objects.get(id=tag_id)
        except Tag.DoesNotExist:
            return Response({'detail': 'Tag not found.'}, status=status.HTTP_404_NOT_FOUND)

        if tag.school_id and tag.school_id != question.school_id:
            return Response({'detail': 'Tag does not belong to the same school.'}, status=status.HTTP_400_BAD_REQUEST)

        if request.data.get('remove'):
            deleted, _ = QuestionTag.objects.filter(question=question, tag=tag).delete()
            return Response({'removed': bool(deleted)})

        relation, created = QuestionTag.objects.get_or_create(question=question, tag=tag)
        return Response({'created': created, 'id': relation.id}, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='semantic_search')
    def semantic_search(self, request):
        query = (request.query_params.get('q') or '').strip()
        if not query:
            return Response([])

        try:
            limit = max(1, min(int(request.query_params.get('limit', 10)), 50))
        except (TypeError, ValueError):
            limit = 10

        queryset = self.get_queryset().filter(embedding__isnull=False)
        if not queryset.exists():
            return Response([])

        query_embedding = generate_text_embedding(query)
        matches = list(
            queryset.prefetch_related('tested_topics__chapter__book')
            .annotate(similarity_distance=CosineDistance('embedding', query_embedding))
            .order_by('similarity_distance')[:limit]
        )

        results = []
        for question in matches:
            first_topic = next(iter(question.tested_topics.all()), None)
            chapter = first_topic.chapter if first_topic else None
            book = chapter.book if chapter else None
            results.append({
                'id': question.id,
                'question_text': question.question_text,
                'question_type': question.question_type,
                'difficulty_level': question.difficulty_level,
                'marks': str(question.marks),
                'similarity_score': max(0.0, 1.0 - float(question.similarity_distance)),
                'chapter_title': chapter.title if chapter else '',
                'topic_title': first_topic.title if first_topic else '',
                'book_title': book.title if book else '',
            })

        return Response(results)
    
    @action(detail=False, methods=['post'])
    def generate_from_lesson(self, request):
        """
        Generate AI questions from a lesson plan.
        
        Body: {
            lesson_plan_id: int,
            question_count: int (5-20),
            question_type: str (MCQ/SHORT/ESSAY/TRUE_FALSE),
            difficulty_level: str (EASY/MEDIUM/HARD)
        }
        
        Returns: {questions: [...], message: "..."}
        """
        from django.conf import settings
        from rest_framework import status
        from lms.models import LessonPlan
        import requests
        import json
        import re
        
        lesson_plan_id = request.data.get('lesson_plan_id')
        question_count = request.data.get('question_count', 5)
        question_type = request.data.get('question_type', 'MCQ')
        difficulty_level = request.data.get('difficulty_level', 'MEDIUM')
        
        # Validate inputs
        if not lesson_plan_id:
            return Response(
                {'error': 'lesson_plan_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not (5 <= question_count <= 20):
            return Response(
                {'error': 'question_count must be between 5 and 20'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Fetch lesson plan
        try:
            lesson = LessonPlan.objects.get(
                id=lesson_plan_id,
                school=request.tenant_school
            )
        except LessonPlan.DoesNotExist:
            return Response(
                {'error': 'Lesson plan not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        school_id = _resolve_school_id(request)
        if not _is_teacher_allowed_for_class_subject(
            request,
            lesson.class_obj_id,
            lesson.subject_id,
            school_id=school_id,
        ):
            return Response(
                {'error': 'You can only generate questions for your assigned class-subjects.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        # Get topics
        topics = lesson.planned_topics.select_related(
            'chapter', 'chapter__book'
        ).all()
        
        if not topics:
            return Response(
                {'error': 'Lesson plan has no topics selected'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Build AI prompt
        topics_text = '\n'.join([
            f"- Chapter {t.chapter.chapter_number}: {t.chapter.title}\n"
            f"  Topic {t.topic_number}: {t.title}\n"
            f"  Description: {t.description or 'N/A'}"
            for t in topics
        ])
        
        prompt = f"""You are an expert educator creating {question_type} questions for {lesson.subject.name} exam at {lesson.class_obj.name} level, {difficulty_level.lower()} difficulty.

Generate exactly {question_count} questions based on these topics:

{topics_text}

For each question:
1. Write clear, concise question text
2. For MCQ: provide 4 options (A, B, C, D) with one correct answer
3. Specify which topic (e.g., "3.2") it tests
4. Assign marks

Respond with ONLY a JSON array, no extra text:
[
  {{
    "question_text": "...",
    "question_type": "{question_type}",
    "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
    "correct_answer": "A",
    "tested_topic_number": "3.2",
    "marks": 2
  }}
]
"""

        ai_job = create_ai_job(
            job_type='generate_questions',
            triggered_by=request.user,
            school=lesson.school,
            input_data={
                'lesson_plan_id': lesson_plan_id,
                'question_count': question_count,
                'question_type': question_type,
                'difficulty_level': difficulty_level,
            },
            model_used=getattr(settings, 'GROQ_MODEL', 'unknown'),
        )
        
        # Call Groq API
        try:
            groq_response = requests.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {settings.GROQ_API_KEY}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': settings.GROQ_MODEL,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0.7,
                    'max_tokens': 2048,
                },
                timeout=30,
            )
            groq_response.raise_for_status()
            
            # Parse response
            ai_text = groq_response.json()['choices'][0]['message']['content'].strip()
            
            # Extract JSON from response
            json_match = re.search(r'\[.*\]', ai_text, re.DOTALL)
            if json_match:
                questions_data = json.loads(json_match.group())
            else:
                questions_data = json.loads(ai_text)
            
            # Create Question objects
            created_questions = []
            for q_data in questions_data:
                # Parse topic number "3.2"
                topic_num_str = q_data.get('tested_topic_number', '')
                parts = topic_num_str.split('.')
                tested_topic = None
                
                if len(parts) == 2:
                    try:
                        ch_num, t_num = int(parts[0]), int(parts[1])
                        for t in topics:
                            if (t.chapter.chapter_number == ch_num and 
                                t.topic_number == t_num):
                                tested_topic = t
                                break
                    except ValueError:
                        pass
                
                # Create question
                question = Question.objects.create(
                    school=request.tenant_school,
                    subject=lesson.subject,
                    question_text=q_data.get('question_text', ''),
                    question_type=question_type,
                    difficulty_level=difficulty_level,
                    marks=q_data.get('marks', 1),
                    option_a=q_data.get('options', {}).get('A', ''),
                    option_b=q_data.get('options', {}).get('B', ''),
                    option_c=q_data.get('options', {}).get('C', ''),
                    option_d=q_data.get('options', {}).get('D', ''),
                    correct_answer=q_data.get('correct_answer', ''),
                    created_by=request.user,
                )
                
                # Link to topic
                if tested_topic:
                    question.tested_topics.add(tested_topic)
                
                created_questions.append(question)
            
            serializer = QuestionSerializer(created_questions, many=True)
            complete_ai_job(
                ai_job,
                output_data={
                    'question_ids': [question.id for question in created_questions],
                    'question_count': len(created_questions),
                },
                accepted=True,
            )
            return Response({
                'message': f'Generated {len(created_questions)} questions',
                'ai_job_id': ai_job.id,
                'questions': serializer.data,
            }, status=status.HTTP_201_CREATED)
            
        except requests.RequestException as e:
            fail_ai_job(ai_job, error_message=e)
            return Response(
                {'error': f'API error: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except json.JSONDecodeError as e:
            fail_ai_job(ai_job, error_message=e)
            return Response(
                {'error': f'Invalid JSON from AI: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
            fail_ai_job(ai_job, error_message=e)
            return Response(
                {'error': f'Generation failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'])
    def by_lesson_plan(self, request):
        """
        Get all questions for a lesson plan's topics.
        Query params: lesson_plan_id (required)
        """
        from lms.models import LessonPlan
        
        lesson_plan_id = request.query_params.get('lesson_plan_id')
        if not lesson_plan_id:
            return Response(
                {'error': 'lesson_plan_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            lesson = LessonPlan.objects.get(
                id=lesson_plan_id,
                school=request.tenant_school
            )
        except LessonPlan.DoesNotExist:
            return Response(
                {'error': 'Lesson plan not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        school_id = _resolve_school_id(request)
        if not _is_teacher_allowed_for_class_subject(
            request,
            lesson.class_obj_id,
            lesson.subject_id,
            school_id=school_id,
        ):
            return Response(
                {'error': 'You can only access questions for your assigned class-subjects.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        topic_ids = lesson.planned_topics.values_list('id', flat=True)
        qs = self.get_queryset().filter(tested_topics__id__in=topic_ids).distinct()
        
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    # Diagram Mode (Paper Builder): a drawn/pasted figure attaches to one of these
    # slots -- the question body, one of the four MCQ options, or the model answer
    # -- each stored as its own Question.*_image_url field rather than embedded in
    # question_text, so PDF/DOCX export renders it as an Image flowable (see
    # pdf_generator.py) instead of it being silently stripped by html_sanitize.py.
    DIAGRAM_SLOT_FIELDS = {
        'question': 'question_image_url',
        'option_a': 'option_a_image_url',
        'option_b': 'option_b_image_url',
        'option_c': 'option_c_image_url',
        'option_d': 'option_d_image_url',
        'answer': 'answer_image_url',
    }

    @action(detail=True, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def diagram(self, request, pk=None):
        """Upload (or replace) a Diagram Mode image for one slot on this question."""
        from core.storage import storage_service, validate_photo_upload

        question = self.get_object()

        slot = request.data.get('slot')
        field_name = self.DIAGRAM_SLOT_FIELDS.get(slot)
        if not field_name:
            return Response(
                {'error': f"slot must be one of: {', '.join(self.DIAGRAM_SLOT_FIELDS)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if 'file' not in request.FILES:
            return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

        file = request.FILES['file']
        try:
            validate_photo_upload(file)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Unlike upload_photo's fixed path-per-entity, upload_question_diagram
            # mints a fresh URL per upload -- so the old file is now orphaned and
            # needs an explicit delete rather than being overwritten in place.
            old_url = getattr(question, field_name)
            if old_url:
                old_path = storage_service._extract_storage_path(old_url)
                if old_path:
                    storage_service.delete_file(old_path)

            url = storage_service.upload_question_diagram(file, question.school_id, question.id, slot)
            setattr(question, field_name, url)
            question.save(update_fields=[field_name, 'updated_at'])

            return Response({'slot': slot, field_name: url, 'message': 'Diagram uploaded successfully.'})
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='remove_diagram')
    def remove_diagram(self, request, pk=None):
        """Remove a Diagram Mode image from one slot on this question."""
        from core.storage import storage_service

        question = self.get_object()

        slot = request.data.get('slot')
        field_name = self.DIAGRAM_SLOT_FIELDS.get(slot)
        if not field_name:
            return Response(
                {'error': f"slot must be one of: {', '.join(self.DIAGRAM_SLOT_FIELDS)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_url = getattr(question, field_name)
        if old_url:
            old_path = storage_service._extract_storage_path(old_url)
            if old_path:
                storage_service.delete_file(old_path)
            setattr(question, field_name, None)
            question.save(update_fields=[field_name, 'updated_at'])

        return Response({'slot': slot, 'message': 'Diagram removed.'})


class ExamPaperViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """ViewSet for ExamPaper management."""
    required_module = 'examinations'
    queryset = ExamPaper.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExamPaperCreateUpdateSerializer
        return ExamPaperSerializer

    def get_queryset(self):
        qs = super().get_queryset()

        if get_effective_role(self.request) == 'TEACHER':
            school_id = _resolve_school_id(self.request)
            class_subject_map = _get_teacher_class_subject_map(self.request, school_id=school_id)
            predicates = Q()
            for class_id, subject_ids in class_subject_map.items():
                if subject_ids:
                    predicates |= Q(class_obj_id=class_id, subject_id__in=list(subject_ids))
            if not predicates:
                return qs.none()
            qs = qs.filter(predicates)
        
        # Filter by class
        class_id = self.request.query_params.get('class_obj')
        if class_id:
            qs = qs.filter(class_obj_id=class_id)
        
        # Filter by subject
        subject_id = self.request.query_params.get('subject')
        if subject_id:
            qs = qs.filter(subject_id=subject_id)
        
        # Filter by exam
        exam_id = self.request.query_params.get('exam')
        if exam_id:
            qs = qs.filter(exam_id=exam_id)
        
        # Filter by status
        paper_status = self.request.query_params.get('status')
        if paper_status:
            qs = qs.filter(status=paper_status)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        
        # Search by title
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(paper_title__icontains=search)
        
        return qs.select_related(
            'class_obj', 'subject', 'exam', 'exam_subject', 'generated_by'
        ).prefetch_related('paper_questions__question')

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        class_obj = serializer.validated_data.get('class_obj')
        subject = serializer.validated_data.get('subject')
        if not _can_manage_exam_scope(
            self.request,
            class_id=getattr(class_obj, 'id', None),
            subject_id=getattr(subject, 'id', None),
            school_id=school_id,
        ):
            raise PermissionDenied('Only School Admin, Principal, or assigned class teachers can create exam papers.')
        serializer.save(school_id=school_id, generated_by=self.request.user)

    def perform_update(self, serializer):
        school_id = _resolve_school_id(self.request)
        class_obj = serializer.validated_data.get('class_obj', serializer.instance.class_obj)
        subject = serializer.validated_data.get('subject', serializer.instance.subject)
        if not _can_manage_exam_scope(
            self.request,
            class_id=getattr(class_obj, 'id', None),
            subject_id=getattr(subject, 'id', None),
            school_id=school_id,
        ):
            raise PermissionDenied('Only School Admin, Principal, or assigned class teachers can edit exam papers.')
        serializer.save()

    def perform_destroy(self, instance):
        # Enforce the same class/subject manage-scope as create/update — this was
        # previously missing, letting any authenticated school user (e.g. a teacher
        # not assigned to the paper's class/subject) soft-delete any paper.
        self._validate_paper_manage_scope(instance.class_obj, instance.subject)
        instance.is_active = False
        instance.save()

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            raise ValidationError({'ids': ['Provide a non-empty list of exam paper ids.']})

        # Scope to what the caller can already see (tenant + teacher-scope from
        # get_queryset), so an id outside that scope is reported as skipped rather
        # than leaking existence via a 404/403 distinction.
        papers = self.get_queryset().filter(id__in=ids).select_related('class_obj', 'subject')
        found_by_id = {paper.id: paper for paper in papers}

        deleted = []
        skipped = []
        for raw_id in ids:
            try:
                paper_id = int(raw_id)
            except (TypeError, ValueError):
                skipped.append({'id': raw_id, 'reason': 'Invalid id.'})
                continue
            paper = found_by_id.get(paper_id)
            if paper is None:
                skipped.append({'id': paper_id, 'reason': 'Not found.'})
                continue
            try:
                self._validate_paper_manage_scope(paper.class_obj, paper.subject)
            except PermissionDenied:
                skipped.append({'id': paper_id, 'reason': 'Not permitted to delete this paper.'})
                continue
            paper.is_active = False
            paper.save(update_fields=['is_active'])
            deleted.append(paper_id)

        return Response({'deleted': deleted, 'skipped': skipped})

    def _validate_paper_manage_scope(self, class_obj, subject):
        school_id = _resolve_school_id(self.request)
        if not _can_manage_exam_scope(
            self.request,
            class_id=getattr(class_obj, 'id', None),
            subject_id=getattr(subject, 'id', None),
            school_id=school_id,
        ):
            raise PermissionDenied('Only School Admin, Principal, or assigned class teachers can create or edit exam papers.')
        return school_id

    def _save_manual_draft_questions(self, exam_paper, manual_questions):
        existing_assignments = {
            paper_question.question_id: paper_question
            for paper_question in exam_paper.paper_questions.select_related('question').all()
        }
        retained_assignment_ids = set()

        for index, raw_question in enumerate(manual_questions, start=1):
            question_payload = dict(raw_question)
            question_id = question_payload.pop('question_id', None)
            question_order = question_payload.pop('question_order', index)
            marks_override = question_payload.pop('marks_override', None)
            section_key = question_payload.pop('section_key', '') or ''
            question_payload.pop('local_id', None)

            assignment = None
            question_instance = None
            if question_id is not None:
                assignment = existing_assignments.get(question_id)
                if assignment is not None:
                    question_instance = assignment.question
                else:
                    # Not yet linked to this paper (e.g. just attached from the question
                    # bank picker) — reuse the existing bank question instead of raising or
                    # creating a duplicate Question row.
                    question_instance = Question.objects.filter(
                        id=question_id, school=exam_paper.school,
                    ).first()
                    if question_instance is None:
                        raise ValidationError({
                            'manual_questions': [f'question_id {question_id} was not found.']
                        })

            if question_instance is not None:
                # Attach-by-reference: the manual/bank-picker UI never lets the user
                # edit an already-existing question's content inline here -- it always
                # carries the bank question's own current content through unchanged
                # (see toDraftQuestionFromBank on the frontend). Re-validating it
                # against today's content-completeness rules (e.g. "SHORT requires
                # answer_text") wrongly blocked reusing any older/legitimate question
                # that predates those rules. Attaching an existing question must always
                # succeed regardless of its own content state -- only genuinely new
                # questions go through full validation below.
                question = question_instance
            else:
                question_payload['subject'] = exam_paper.subject_id
                serializer = QuestionCreateUpdateSerializer(
                    instance=None,
                    data=question_payload,
                    context={'request': self.request},
                )
                serializer.is_valid(raise_exception=True)
                question = serializer.save(
                    school=exam_paper.school,
                    created_by=self.request.user,
                )

            if assignment is None:
                assignment = PaperQuestion(
                    exam_paper=exam_paper,
                    question=question,
                )

            assignment.question_order = question_order
            assignment.section_key = str(section_key)[:50]
            assignment.marks_override = marks_override
            assignment.save()
            assignment.sync_question_snapshot()
            retained_assignment_ids.add(assignment.id)

        exam_paper.paper_questions.exclude(id__in=retained_assignment_ids).delete()

    @action(detail=False, methods=['post'], url_path='ensure-draft')
    def ensure_draft(self, request):
        """Create or refresh a server-backed draft paper before autosave begins."""
        draft_id = request.data.get('draft_id') or request.data.get('id')
        exam_paper = None

        if draft_id:
            exam_paper = self.get_queryset().filter(pk=draft_id).first()
            if exam_paper is None:
                return Response({'detail': 'Draft paper not found.'}, status=status.HTTP_404_NOT_FOUND)
            if exam_paper.status != ExamPaper.Status.DRAFT:
                return Response(
                    {'detail': 'Only draft papers can be resumed for autosave.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = ExamPaperDraftEnsureSerializer(
            instance=exam_paper,
            data=request.data,
            partial=exam_paper is not None,
        )
        serializer.is_valid(raise_exception=True)

        class_obj = serializer.validated_data.get('class_obj', getattr(exam_paper, 'class_obj', None))
        subject = serializer.validated_data.get('subject', getattr(exam_paper, 'subject', None))
        school_id = self._validate_paper_manage_scope(class_obj, subject)

        with transaction.atomic():
            if exam_paper is None:
                exam_paper = serializer.save(
                    school_id=school_id,
                    generated_by=request.user,
                    status=ExamPaper.Status.DRAFT,
                )
                http_status = status.HTTP_201_CREATED
            else:
                exam_paper = serializer.save(status=ExamPaper.Status.DRAFT)
                http_status = status.HTTP_200_OK

        return Response(ExamPaperSerializer(exam_paper).data, status=http_status)

    @action(detail=True, methods=['post'])
    def autosave(self, request, pk=None):
        """Autosave draft metadata and manual-entry questions into the question bank."""
        exam_paper = self.get_object()
        if exam_paper.status != ExamPaper.Status.DRAFT:
            return Response(
                {'detail': 'Only draft papers can be autosaved.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ExamPaperDraftAutosaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        manual_questions = validated.pop('manual_questions', None)

        class_obj = validated.get('class_obj', exam_paper.class_obj)
        subject = validated.get('subject', exam_paper.subject)
        self._validate_paper_manage_scope(class_obj, subject)

        with transaction.atomic():
            for attr, value in validated.items():
                setattr(exam_paper, attr, value)
            exam_paper.save()

            if manual_questions is not None:
                self._save_manual_draft_questions(exam_paper, manual_questions)

        exam_paper.refresh_from_db()
        return Response(ExamPaperSerializer(exam_paper).data)

    @action(detail=True, methods=['get'], url_path='generate-pdf')
    def generate_pdf(self, request, pk=None):
        """Generate and download PDF for this exam paper."""
        from .pdf_generator import ExamPaperPDFGenerator
        
        exam_paper = self.get_object()
        
        try:
            generator = ExamPaperPDFGenerator(exam_paper)
            pdf_bytes = generator.generate()
            
            # Create filename
            filename = f"{exam_paper.paper_title.replace(' ', '_')}.pdf"
            
            response = HttpResponse(pdf_bytes, content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            
            return response
        
        except Exception as e:
            return Response(
                {'detail': f'Error generating PDF: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['get'], url_path='generate-docx')
    def generate_docx(self, request, pk=None):
        """Generate and download DOCX for this exam paper."""
        from .docx_generator import ExamPaperDOCXGenerator

        exam_paper = self.get_object()

        try:
            generator = ExamPaperDOCXGenerator(exam_paper)
            docx_bytes = generator.generate()

            filename = f"{exam_paper.paper_title.replace(' ', '_')}.docx"

            response = HttpResponse(
                docx_bytes,
                content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            )
            response['Content-Disposition'] = f'attachment; filename="{filename}"'

            return response

        except Exception as e:
            return Response(
                {'detail': f'Error generating DOCX: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def link_lesson_plans(self, request, pk=None):
        """
        Link lesson plans to this exam paper.
        Body: {lesson_plan_ids: [1, 2, 3]}
        """
        from lms.models import LessonPlan
        
        exam_paper = self.get_object()
        lesson_plan_ids = request.data.get('lesson_plan_ids', [])
        
        lesson_plans = LessonPlan.objects.filter(
            id__in=lesson_plan_ids,
            school=request.tenant_school
        )
        
        exam_paper.lesson_plans.set(lesson_plans)
        
        serializer = self.get_serializer(exam_paper)
        return Response({
            'message': f'Linked {lesson_plans.count()} lesson plans',
            'exam_paper': serializer.data
        })
    
    @action(detail=True, methods=['get'])
    def coverage_stats(self, request, pk=None):
        """
        Get coverage statistics for this exam paper.
        Returns: topics count, covered topics, lesson plans, SLO coverage, etc.

        `planned_topics_coverage` inlines every topic planned across the paper's
        linked lesson plans, each with its SLOs and whether this paper covers it.
        Added so the frontend coverage panel can render entirely from this one
        response instead of firing a separate request per linked lesson plan and
        per distinct topic (the old approach fanned out via useQueries).
        """
        from lms.models import Topic

        exam_paper = self.get_object()
        covered_topic_ids = set(exam_paper.covered_topics.values_list('id', flat=True))
        slo_coverage_count = exam_paper.covered_topics.filter(
            standard_alignments__isnull=False,
        ).values('standard_alignments__objective_id').distinct().count()

        planned_topics = Topic.objects.filter(
            lesson_plans__in=exam_paper.lesson_plans.all(),
        ).distinct().select_related('chapter').prefetch_related('standard_alignments__objective')

        planned_topics_coverage = []
        all_slo_ids = set()
        for topic in planned_topics:
            is_covered = topic.id in covered_topic_ids
            slos = [
                {
                    'id': alignment.objective_id,
                    'code': alignment.objective.code,
                    'statement': alignment.objective.statement,
                }
                for alignment in topic.standard_alignments.all()
            ]
            all_slo_ids.update(slo['id'] for slo in slos)
            planned_topics_coverage.append({
                'topic_id': topic.id,
                'chapter': f"{topic.chapter.chapter_number}: {topic.chapter.title}",
                'topic': f"{topic.topic_number}: {topic.title}",
                'is_covered': is_covered,
                'slos': slos,
            })

        return Response({
            'exam_paper_id': exam_paper.id,
            'paper_title': exam_paper.paper_title,
            'total_questions': exam_paper.question_count,
            'total_marks': exam_paper.total_marks,
            'covered_topics': [
                {
                    'id': t.id,
                    'chapter': f"{t.chapter.chapter_number}: {t.chapter.title}",
                    'topic': f"{t.topic_number}: {t.title}",
                    'questions_count': t.test_questions.filter(
                        paper_assignments__exam_paper=exam_paper
                    ).count(),
                }
                for t in exam_paper.covered_topics
            ],
            'linked_lesson_plans': [
                {
                    'id': lp.id,
                    'title': lp.title,
                    'lesson_date': lp.lesson_date,
                }
                for lp in exam_paper.lesson_plans.all()
            ],
            'planned_topics_coverage': planned_topics_coverage,
            'total_slo_count': len(all_slo_ids),
            'topic_count': exam_paper.covered_topics.count(),
            'slo_coverage_count': slo_coverage_count,
            # Backward-compatible aliases used by older clients/tests.
            'covered_slos': slo_coverage_count,
            'slo_coverage': slo_coverage_count,
        })
    
    @action(detail=False, methods=['post'])
    def create_from_lessons(self, request):
        """
        Create exam paper from lesson plans.
        
        Body: {
            lesson_plan_ids: [1, 2, 3],
            class_id: 5,
            subject_id: 10,
            paper_title: "Mid-Term Exam",
            instructions: "...",
            total_marks: 100,
            duration_minutes: 60,
            question_type: "MCQ",
            difficulty_balance: {"EASY": 0.3, "MEDIUM": 0.5, "HARD": 0.2}
        }
        """
        from lms.models import LessonPlan
        
        lesson_plan_ids = request.data.get('lesson_plan_ids', [])
        class_id = request.data.get('class_id')
        subject_id = request.data.get('subject_id')
        paper_title = request.data.get('paper_title')
        instructions = request.data.get('instructions', '')
        total_marks = request.data.get('total_marks', 100)
        duration_minutes = request.data.get('duration_minutes', 60)
        
        if not (lesson_plan_ids and class_id and subject_id and paper_title):
            return Response(
                {'error': 'Missing required fields'},
                status=status.HTTP_400_BAD_REQUEST
            )

        school_id = _resolve_school_id(request)
        if not _can_manage_exam_scope(
            request,
            class_id=class_id,
            subject_id=subject_id,
            school_id=school_id,
        ):
            return Response(
                {'error': 'Only School Admin, Principal, or assigned class teachers can create exam papers.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        # Fetch lesson plans
        lesson_plans = LessonPlan.objects.filter(
            id__in=lesson_plan_ids,
            school=request.tenant_school
        )
        
        if not lesson_plans.exists():
            return Response(
                {'error': 'No lesson plans found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get topics from lesson plans
        topic_ids = set()
        for lp in lesson_plans:
            topic_ids.update(lp.planned_topics.values_list('id', flat=True))
        
        if not topic_ids:
            return Response(
                {'error': 'Selected lesson plans have no topics'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get questions for those topics
        questions_qs = Question.objects.filter(
            school=request.tenant_school,
            subject_id=subject_id,
            tested_topics__id__in=topic_ids,
            is_active=True
        ).distinct()
        
        if not questions_qs.exists():
            return Response(
                {'error': 'No questions available for selected topics'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create exam paper
        exam_paper = ExamPaper.objects.create(
            school=request.tenant_school,
            class_obj_id=class_id,
            subject_id=subject_id,
            paper_title=paper_title,
            instructions=instructions,
            total_marks=total_marks,
            duration_minutes=duration_minutes,
            status='DRAFT',
            generated_by=request.user,
        )
        
        # Link lesson plans
        exam_paper.lesson_plans.set(lesson_plans)
        
        # Add questions (balance by difficulty if needed)
        selected_questions = list(questions_qs[:15])  # Default: up to 15 questions
        
        for idx, q in enumerate(selected_questions):
            paper_question = PaperQuestion.objects.create(
                exam_paper=exam_paper,
                question=q,
                question_order=idx + 1,
                marks_override=q.marks,
            )
            paper_question.sync_question_snapshot()
        
        serializer = ExamPaperSerializer(exam_paper)
        return Response({
            'message': f'Created paper with {len(selected_questions)} questions',
            'exam_paper': serializer.data,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='review-questions')
    def review_questions(self, request):
        """AI-powered grammar and spelling review for questions."""
        from .paper_ocr_processor import QuestionReviewAI
        
        serializer = QuestionReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        question_texts = serializer.validated_data['questions']
        
        try:
            reviewer = QuestionReviewAI()
            results = reviewer.review_questions(question_texts)
            
            return Response({'results': results}, status=status.HTTP_200_OK)
        
        except Exception as e:
            return Response(
                {'detail': f'Error reviewing questions: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PaperUploadViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """ViewSet for PaperUpload management (image uploads for OCR)."""
    required_module = 'examinations'
    queryset = PaperUpload.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]
    serializer_class = PaperUploadSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        
        # Filter by status
        upload_status = self.request.query_params.get('status')
        if upload_status:
            qs = qs.filter(status=upload_status)
        
        # Filter by uploaded user
        if self.request.query_params.get('my_uploads') == 'true':
            qs = qs.filter(uploaded_by=self.request.user)
        
        return qs.select_related('school', 'exam_paper', 'uploaded_by').order_by('-created_at')

    @action(detail=False, methods=['post'], url_path='upload-image')
    def upload_image(self, request):
        """Upload paper image and trigger OCR processing.

        Multi-page capture: omit group_id for page 1 (a new one is generated and
        returned in the response); pass that same group_id back for page 2, 3, ...
        so the OCR task can build continuation context from the prior page(s) of
        this group. page_number is auto-computed server-side when omitted.
        """
        from core.storage import SupabaseStorageService
        from .tasks import process_paper_upload_ocr
        
        serializer = PaperUploadCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        image_file = serializer.validated_data['image']
        context_class_id = serializer.validated_data.get('class_obj')
        context_subject_id = serializer.validated_data.get('subject')
        school_id = _resolve_school_id(request)

        if not school_id:
            return Response(
                {'detail': 'School ID is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Multi-page capture: no group_id means this is page 1 of a new session --
        # generate one for the frontend to echo back on subsequent pages. When a
        # group_id IS given, compute the next page_number server-side (rather than
        # trusting the client's own count) so a retried/duplicate request can't
        # collide with or skip a page number already used in this group.
        import uuid as uuid_lib
        group_id = serializer.validated_data.get('group_id')
        page_number = serializer.validated_data.get('page_number')
        if group_id is None:
            group_id = uuid_lib.uuid4()
            page_number = 1
        elif page_number is None:
            last_page_number = PaperUpload.objects.filter(
                school_id=school_id, group_id=group_id
            ).order_by('-page_number').values_list('page_number', flat=True).first()
            page_number = (last_page_number or 0) + 1

        try:
            # Upload to Supabase storage
            storage_service = SupabaseStorageService()
            
            # Use a folder structure: papers/{school_id}/{timestamp}
            from datetime import datetime
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            folder_path = f"papers/{school_id}"
            
            image_url = storage_service.upload_file(
                file=image_file,
                folder= folder_path,
                filename=f"paper_{timestamp}_{image_file.name}"
            )
            
            # Create PaperUpload record
            upload = PaperUpload.objects.create(
                school_id=school_id,
                uploaded_by=request.user,
                image_url=image_url,
                group_id=group_id,
                page_number=page_number,
                context_class_id=context_class_id,
                context_subject_id=context_subject_id,
                status=PaperUpload.Status.PENDING
            )
            
            # Trigger async OCR processing
            from core.task_utils import call_task
            call_task(process_paper_upload_ocr, upload.id)
            
            return Response(
                PaperUploadSerializer(upload).data,
                status=status.HTTP_201_CREATED
            )
        
        except Exception as e:
            return Response(
                {'detail': f'Error uploading image: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='confirm')
    def confirm_extraction(self, request, pk=None):
        """Confirm extracted questions.

        Two modes:
        - exam_paper_id provided (current draft-pipeline flow): the paper and its
          questions were already created via ensure-draft + autosave, using the same
          manual_questions path as typed entry. This call only records the
          PaperFeedback learning-loop row and marks/links the upload — it never
          creates ExamPaper/Question/PaperQuestion rows itself.
        - exam_paper_id absent (legacy one-shot flow, kept for API compatibility):
          creates the ExamPaper and its Questions directly from confirmed_data.
        """
        upload = self.get_object()

        if upload.status != PaperUpload.Status.EXTRACTED:
            return Response(
                {'detail': 'Upload must be in EXTRACTED status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get confirmed data from request
        confirmed_json = request.data.get('confirmed_data')
        paper_metadata = request.data.get('paper_metadata', {})
        exam_paper_id = request.data.get('exam_paper_id')

        if not confirmed_json:
            return Response(
                {'detail': 'confirmed_data is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            school_id = _resolve_school_id(request)

            if exam_paper_id:
                exam_paper = ExamPaper.objects.filter(id=exam_paper_id, school_id=school_id).first()
                if exam_paper is None:
                    return Response(
                        {'detail': 'exam_paper_id was not found for this school.'},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                if not _can_manage_exam_scope(
                    request,
                    class_id=exam_paper.class_obj_id,
                    subject_id=exam_paper.subject_id,
                    school_id=school_id,
                ):
                    return Response(
                        {'detail': 'Only School Admin, Principal, or assigned class teachers can confirm exam papers.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                questions = confirmed_json.get('questions', [])

                # Feedback-only: the draft pipeline already created the paper/questions.
                PaperFeedback.objects.create(
                    paper_upload=upload,
                    ai_extracted_json=upload.ai_extracted_json,
                    user_confirmed_json=confirmed_json,
                    accuracy_metrics={
                        'total_questions': len(questions),
                        'extraction_confidence': upload.extraction_confidence
                    },
                    confirmed_by=request.user
                )

                upload.status = PaperUpload.Status.CONFIRMED
                upload.exam_paper = exam_paper
                upload.save()

                return Response(
                    {
                        'detail': 'Paper successfully confirmed',
                        'exam_paper_id': exam_paper.id,
                        'questions_created': exam_paper.question_count,
                    },
                    status=status.HTTP_200_OK
                )

            # Legacy one-shot flow: no exam_paper_id, so create everything here.
            if not _can_manage_exam_scope(
                request,
                class_id=paper_metadata.get('class_obj'),
                subject_id=paper_metadata.get('subject'),
                school_id=school_id,
            ):
                return Response(
                    {'detail': 'Only School Admin, Principal, or assigned class teachers can create exam papers.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Create ExamPaper
            exam_paper = ExamPaper.objects.create(
                school_id=school_id,
                class_obj_id=paper_metadata.get('class_obj'),
                subject_id=paper_metadata.get('subject'),
                exam_id=paper_metadata.get('exam'),
                exam_subject_id=paper_metadata.get('exam_subject'),
                paper_title=paper_metadata.get('paper_title', 'Untitled Paper'),
                instructions=paper_metadata.get('instructions', ''),
                total_marks=paper_metadata.get('total_marks', 100),
                duration_minutes=paper_metadata.get('duration_minutes', 60),
                status=ExamPaper.Status.DRAFT,
                generated_by=request.user
            )

            # Create Questions from confirmed data
            questions = confirmed_json.get('questions', [])
            for idx, q_data in enumerate(questions, start=1):
                question = Question.objects.create(
                    school_id=school_id,
                    subject_id=paper_metadata.get('subject'),
                    question_text=q_data.get('question_text', ''),
                    question_type=q_data.get('question_type', 'SHORT'),
                    difficulty_level=q_data.get('difficulty_level', 'MEDIUM'),
                    marks=q_data.get('marks', 1),
                    option_a=q_data.get('options', {}).get('A', ''),
                    option_b=q_data.get('options', {}).get('B', ''),
                    option_c=q_data.get('options', {}).get('C', ''),
                    option_d=q_data.get('options', {}).get('D', ''),
                    created_by=request.user,
                )

                # Link question to paper
                paper_question = PaperQuestion.objects.create(
                    exam_paper=exam_paper,
                    question=question,
                    question_order=idx,
                    marks_override=q_data.get('marks')
                )
                paper_question.sync_question_snapshot()

            # Create feedback record for learning loop
            PaperFeedback.objects.create(
                paper_upload=upload,
                ai_extracted_json=upload.ai_extracted_json,
                user_confirmed_json=confirmed_json,
                accuracy_metrics={
                    'total_questions': len(questions),
                    'extraction_confidence': upload.extraction_confidence
                },
                confirmed_by=request.user
            )

            # Update upload status
            upload.status = PaperUpload.Status.CONFIRMED
            upload.exam_paper = exam_paper
            upload.save()

            return Response(
                {
                    'detail': 'Paper successfully confirmed',
                    'exam_paper_id': exam_paper.id,
                    'questions_created': len(questions)
                },
                status=status.HTTP_200_OK
            )

        except Exception as e:
            return Response(
                {'detail': f'Error confirming extraction: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class WorksheetViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """ViewSet for Worksheet management -- sibling of ExamPaperViewSet, reusing
    the same manage-scope check (_can_manage_exam_scope is generic to
    class/subject, not exam-paper specific) but with no exam-lifecycle fields."""
    required_module = 'examinations'
    queryset = Worksheet.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return WorksheetDraftEnsureSerializer
        return WorksheetSerializer

    def get_queryset(self):
        qs = super().get_queryset()

        if get_effective_role(self.request) == 'TEACHER':
            school_id = _resolve_school_id(self.request)
            class_subject_map = _get_teacher_class_subject_map(self.request, school_id=school_id)
            predicates = Q()
            for class_id, subject_ids in class_subject_map.items():
                if subject_ids:
                    predicates |= Q(class_obj_id=class_id, subject_id__in=list(subject_ids))
                    predicates |= Q(class_obj_id=class_id, subject_id__isnull=True)
            if not predicates:
                return qs.none()
            qs = qs.filter(predicates)

        class_id = self.request.query_params.get('class_obj')
        if class_id:
            qs = qs.filter(class_obj_id=class_id)

        subject_id = self.request.query_params.get('subject')
        if subject_id:
            qs = qs.filter(subject_id=subject_id)

        worksheet_status = self.request.query_params.get('status')
        if worksheet_status:
            qs = qs.filter(status=worksheet_status)

        topic_id = self.request.query_params.get('tested_topics')
        if topic_id:
            qs = qs.filter(tested_topics__id=topic_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(title__icontains=search)

        return qs.select_related('class_obj', 'subject', 'created_by').prefetch_related(
            'items__question', 'tested_topics__chapter',
        ).distinct()

    def _validate_manage_scope(self, class_obj, subject):
        school_id = _resolve_school_id(self.request)
        if not _can_manage_exam_scope(
            self.request,
            class_id=getattr(class_obj, 'id', None),
            subject_id=getattr(subject, 'id', None),
            school_id=school_id,
        ):
            raise PermissionDenied('Only School Admin, Principal, or assigned class teachers can create or edit worksheets.')
        return school_id

    def perform_create(self, serializer):
        class_obj = serializer.validated_data.get('class_obj')
        subject = serializer.validated_data.get('subject')
        school_id = self._validate_manage_scope(class_obj, subject)
        serializer.save(school_id=school_id, created_by=self.request.user)

    def perform_update(self, serializer):
        class_obj = serializer.validated_data.get('class_obj', serializer.instance.class_obj)
        subject = serializer.validated_data.get('subject', serializer.instance.subject)
        self._validate_manage_scope(class_obj, subject)
        serializer.save()

    def perform_destroy(self, instance):
        self._validate_manage_scope(instance.class_obj, instance.subject)
        instance.is_active = False
        instance.save()

    def _save_manual_draft_items(self, worksheet, manual_items):
        existing_assignments = {
            item.question_id: item
            for item in worksheet.items.select_related('question').all()
        }
        retained_ids = set()

        for index, raw_item in enumerate(manual_items, start=1):
            item_payload = dict(raw_item)
            question_id = item_payload.pop('question_id', None)
            item_order = item_payload.pop('item_order', item_payload.pop('question_order', index))
            marks_override = item_payload.pop('marks_override', None)
            section_key = item_payload.pop('section_key', '') or ''
            item_payload.pop('local_id', None)

            assignment = None
            question_instance = None
            if question_id is not None:
                assignment = existing_assignments.get(question_id)
                if assignment is not None:
                    question_instance = assignment.question
                else:
                    # Not yet linked to this worksheet (e.g. attached from the question
                    # bank picker) -- reuse the existing bank question rather than raising
                    # or creating a duplicate Question row.
                    question_instance = Question.objects.filter(
                        id=question_id, school=worksheet.school,
                    ).first()
                    if question_instance is None:
                        raise ValidationError({
                            'manual_items': [f'question_id {question_id} was not found.']
                        })

            if question_instance is not None:
                # Attach-by-reference: never re-validate an already-existing question's
                # content against today's completeness rules -- see the identical
                # comment in ExamPaperViewSet._save_manual_draft_questions.
                question = question_instance
            else:
                item_payload['subject'] = item_payload.get('subject') or worksheet.subject_id
                if not item_payload['subject']:
                    raise ValidationError({
                        'manual_items': ['subject is required for a new question when the worksheet has no subject.']
                    })
                serializer = QuestionCreateUpdateSerializer(
                    instance=None,
                    data=item_payload,
                    context={'request': self.request},
                )
                serializer.is_valid(raise_exception=True)
                question = serializer.save(
                    school=worksheet.school,
                    created_by=self.request.user,
                )

            if assignment is None:
                assignment = WorksheetItem(worksheet=worksheet, question=question)

            assignment.item_order = item_order
            assignment.section_key = str(section_key)[:50]
            assignment.marks_override = marks_override
            assignment.save()
            assignment.sync_item_snapshot()
            retained_ids.add(assignment.id)

        worksheet.items.exclude(id__in=retained_ids).delete()

    @action(detail=False, methods=['post'], url_path='ensure-draft')
    def ensure_draft(self, request):
        """Create or refresh a server-backed draft worksheet before autosave begins."""
        draft_id = request.data.get('draft_id') or request.data.get('id')
        worksheet = None

        if draft_id:
            worksheet = self.get_queryset().filter(pk=draft_id).first()
            if worksheet is None:
                return Response({'detail': 'Draft worksheet not found.'}, status=status.HTTP_404_NOT_FOUND)
            if worksheet.status != Worksheet.Status.DRAFT:
                return Response(
                    {'detail': 'Only draft worksheets can be resumed for autosave.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = WorksheetDraftEnsureSerializer(
            instance=worksheet,
            data=request.data,
            partial=worksheet is not None,
        )
        serializer.is_valid(raise_exception=True)

        class_obj = serializer.validated_data.get('class_obj', getattr(worksheet, 'class_obj', None))
        subject = serializer.validated_data.get('subject', getattr(worksheet, 'subject', None))
        school_id = self._validate_manage_scope(class_obj, subject)

        with transaction.atomic():
            if worksheet is None:
                worksheet = serializer.save(
                    school_id=school_id,
                    created_by=request.user,
                    status=Worksheet.Status.DRAFT,
                )
                http_status = status.HTTP_201_CREATED
            else:
                worksheet = serializer.save(status=Worksheet.Status.DRAFT)
                http_status = status.HTTP_200_OK

        return Response(WorksheetSerializer(worksheet).data, status=http_status)

    @action(detail=True, methods=['post'])
    def autosave(self, request, pk=None):
        """Autosave draft metadata and manual-entry items into the question bank."""
        worksheet = self.get_object()
        if worksheet.status != Worksheet.Status.DRAFT:
            return Response(
                {'detail': 'Only draft worksheets can be autosaved.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = WorksheetDraftAutosaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        manual_items = validated.pop('manual_items', None)
        tested_topics = validated.pop('tested_topics', None)

        class_obj = validated.get('class_obj', worksheet.class_obj)
        subject = validated.get('subject', worksheet.subject)
        self._validate_manage_scope(class_obj, subject)

        with transaction.atomic():
            for attr, value in validated.items():
                setattr(worksheet, attr, value)
            worksheet.save()

            if tested_topics is not None:
                worksheet.tested_topics.set(tested_topics)

            if manual_items is not None:
                self._save_manual_draft_items(worksheet, manual_items)

        worksheet.refresh_from_db()
        return Response(WorksheetSerializer(worksheet).data)

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Duplicate a worksheet (with its items) as a new draft -- handy for
        reusing one worksheet across sections of the same class."""
        source = self.get_object()
        self._validate_manage_scope(source.class_obj, source.subject)

        with transaction.atomic():
            clone = Worksheet.objects.create(
                school=source.school,
                class_obj=source.class_obj,
                subject=source.subject,
                title=f"{source.title} (Copy)",
                instructions=source.instructions,
                structure=source.structure,
                render_options=source.render_options,
                status=Worksheet.Status.DRAFT,
                source=source.source,
                created_by=request.user,
            )
            clone.tested_topics.set(source.tested_topics.all())
            for item in source.items.all():
                WorksheetItem.objects.create(
                    worksheet=clone,
                    question=item.question,
                    item_order=item.item_order,
                    section_key=item.section_key,
                    marks_override=item.marks_override,
                    item_snapshot=item.item_snapshot,
                )

        return Response(WorksheetSerializer(clone).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='generate-pdf')
    def generate_pdf(self, request, pk=None):
        """Generate and download PDF for this worksheet."""
        from .pdf_generator import WorksheetPDFGenerator

        worksheet = self.get_object()
        try:
            generator = WorksheetPDFGenerator(worksheet)
            pdf_bytes = generator.generate()

            filename = f"{worksheet.title.replace(' ', '_')}.pdf"
            response = HttpResponse(pdf_bytes, content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            return response
        except Exception as e:
            return Response(
                {'detail': f'Error generating PDF: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['get'], url_path='generate-docx')
    def generate_docx(self, request, pk=None):
        """Generate and download DOCX for this worksheet."""
        from .docx_generator import WorksheetDOCXGenerator

        worksheet = self.get_object()
        try:
            generator = WorksheetDOCXGenerator(worksheet)
            docx_bytes = generator.generate()

            filename = f"{worksheet.title.replace(' ', '_')}.docx"
            response = HttpResponse(
                docx_bytes,
                content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            )
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            return response
        except Exception as e:
            return Response(
                {'detail': f'Error generating DOCX: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class WorksheetUploadViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """ViewSet for WorksheetUpload management (image uploads for OCR) -- mirrors
    PaperUploadViewSet, minus the exam_paper_id draft-pipeline branch of confirm
    (worksheets have no answer-key/feedback-learning-loop requirement)."""
    required_module = 'examinations'
    queryset = WorksheetUpload.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]
    serializer_class = WorksheetUploadSerializer

    def get_queryset(self):
        qs = super().get_queryset()

        upload_status = self.request.query_params.get('status')
        if upload_status:
            qs = qs.filter(status=upload_status)

        if self.request.query_params.get('my_uploads') == 'true':
            qs = qs.filter(uploaded_by=self.request.user)

        return qs.select_related('school', 'worksheet', 'uploaded_by').order_by('-created_at')

    @action(detail=False, methods=['post'], url_path='upload-image')
    def upload_image(self, request):
        """Upload worksheet image and trigger OCR processing."""
        from core.storage import SupabaseStorageService
        from .tasks import process_worksheet_upload_ocr

        serializer = WorksheetUploadCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        image_file = serializer.validated_data['image']
        context_class_id = serializer.validated_data.get('class_obj')
        context_subject_id = serializer.validated_data.get('subject')
        school_id = _resolve_school_id(request)

        if not school_id:
            return Response(
                {'detail': 'School ID is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        import uuid as uuid_lib
        group_id = serializer.validated_data.get('group_id')
        page_number = serializer.validated_data.get('page_number')
        if group_id is None:
            group_id = uuid_lib.uuid4()
            page_number = 1
        elif page_number is None:
            last_page_number = WorksheetUpload.objects.filter(
                school_id=school_id, group_id=group_id
            ).order_by('-page_number').values_list('page_number', flat=True).first()
            page_number = (last_page_number or 0) + 1

        try:
            storage_service = SupabaseStorageService()

            from datetime import datetime
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            folder_path = f"worksheets/{school_id}"

            image_url = storage_service.upload_file(
                file=image_file,
                folder=folder_path,
                filename=f"worksheet_{timestamp}_{image_file.name}"
            )

            upload = WorksheetUpload.objects.create(
                school_id=school_id,
                uploaded_by=request.user,
                image_url=image_url,
                group_id=group_id,
                page_number=page_number,
                context_class_id=context_class_id,
                context_subject_id=context_subject_id,
                status=WorksheetUpload.Status.PENDING
            )

            from core.task_utils import call_task
            call_task(process_worksheet_upload_ocr, upload.id)

            return Response(
                WorksheetUploadSerializer(upload).data,
                status=status.HTTP_201_CREATED
            )

        except Exception as e:
            return Response(
                {'detail': f'Error uploading image: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='confirm')
    def confirm_extraction(self, request, pk=None):
        """Confirm extracted questions -- records confirmation and links the
        worksheet (already created via ensure-draft + autosave, same as the
        manual-entry path). No feedback-learning-loop row: PaperFeedback is
        scoped to PaperUpload and worksheets deliberately don't get an
        equivalent (see the "no answer key" scoping decision for this feature)."""
        upload = self.get_object()

        if upload.status != WorksheetUpload.Status.EXTRACTED:
            return Response(
                {'detail': 'Upload must be in EXTRACTED status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        worksheet_id = request.data.get('worksheet_id')
        if not worksheet_id:
            return Response(
                {'detail': 'worksheet_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        school_id = _resolve_school_id(request)
        worksheet = Worksheet.objects.filter(id=worksheet_id, school_id=school_id).first()
        if worksheet is None:
            return Response(
                {'detail': 'worksheet_id was not found for this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _can_manage_exam_scope(
            request,
            class_id=worksheet.class_obj_id,
            subject_id=worksheet.subject_id,
            school_id=school_id,
        ):
            return Response(
                {'detail': 'Only School Admin, Principal, or assigned class teachers can confirm worksheets.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        upload.status = WorksheetUpload.Status.CONFIRMED
        upload.worksheet = worksheet
        upload.save()

        return Response(WorksheetUploadSerializer(upload).data)


class PaperFeedbackViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
    """ViewSet for PaperFeedback (read-only for analytics)."""
    required_module = 'examinations'
    queryset = PaperFeedback.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
    serializer_class = PaperFeedbackSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.select_related('paper_upload', 'confirmed_by').order_by('-created_at')


class AcademicRiskView(APIView):
    """AI Academic Risk Predictor - identifies students trending toward failing grades."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from .academic_risk_service import AcademicRiskService
        from academic_sessions.models import AcademicYear

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        academic_year_id = request.query_params.get('academic_year')

        if not academic_year_id:
            current = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()
            if not current:
                return Response(
                    {'detail': 'No current academic year set for this school.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            academic_year_id = current.id

        explicit_threshold = request.query_params.get('threshold')
        if explicit_threshold is None:
            from schools.models import School
            school = School.objects.filter(id=school_id).only('id', 'academic_risk_config').first()
            threshold = float((school.academic_risk_config or {}).get('risk_pass_threshold', 40.0)) if school else 40.0
        else:
            threshold = float(explicit_threshold)

        service = AcademicRiskService(school_id, int(academic_year_id))
        result = service.get_at_risk_students(threshold=threshold)

        return Response(result)
