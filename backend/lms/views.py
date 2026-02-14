"""
LMS views for lesson plans, assignments, and submissions.
"""

import logging
from django.utils import timezone
from django.db.models import Count
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
    get_effective_role, ADMIN_ROLES, STAFF_LEVEL_ROLES,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from .models import LessonPlan, Assignment, AssignmentSubmission
from .serializers import (
    LessonPlanReadSerializer, LessonPlanCreateSerializer,
    AssignmentReadSerializer, AssignmentCreateSerializer,
    AssignmentSubmissionReadSerializer, AssignmentSubmissionCreateSerializer,
)

logger = logging.getLogger(__name__)


class LessonPlanViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing lesson plans.

    - Admins/Principals have full CRUD access.
    - Teachers can create and edit their own lesson plans.
    - Other authenticated users have read-only access.

    Query params:
        class_id   - filter by class
        subject_id - filter by subject
        teacher_id - filter by teacher
        status     - filter by status (DRAFT, PUBLISHED)
    """
    required_module = 'lms'
    queryset = LessonPlan.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return LessonPlanCreateSerializer
        return LessonPlanReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'academic_year', 'class_obj', 'subject', 'teacher',
        ).prefetch_related('attachments')

        # Filter by class
        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by subject
        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)

        # Filter by teacher
        teacher_id = self.request.query_params.get('teacher_id')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)

        # Filter by status
        plan_status = self.request.query_params.get('status')
        if plan_status:
            queryset = queryset.filter(status=plan_status)

        # Filter by academic year
        academic_year_id = self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        return queryset

    def perform_create(self, serializer):
        """
        Auto-resolve academic year if not provided.
        Teachers creating their own plans: the teacher FK must match
        their StaffMember profile (enforced at serializer/frontend level).
        """
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            school_id = (
                ensure_tenant_school_id(self.request)
                or self.request.user.school_id
            )
            academic_year = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()

        super().perform_create(serializer)

        # If academic year was resolved, update the saved instance
        if academic_year and not serializer.validated_data.get('academic_year'):
            instance = serializer.instance
            instance.academic_year = academic_year
            instance.save(update_fields=['academic_year'])

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        """
        Get lesson plans filtered by class_id query param.

        GET /api/lms/lesson-plans/by_class/?class_id=5
        """
        class_id = request.query_params.get('class_id')
        if not class_id:
            return Response(
                {'error': 'class_id query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = self.get_queryset().filter(class_obj_id=class_id)
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


class AssignmentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing assignments.

    - Admins/Principals have full CRUD access.
    - Teachers can create and edit their own assignments.
    - Other authenticated users have read-only access.
    - `publish` action changes status to PUBLISHED.
    - `close` action changes status to CLOSED.

    Query params:
        class_id   - filter by class
        subject_id - filter by subject
        teacher_id - filter by teacher
        status     - filter by status (DRAFT, PUBLISHED, CLOSED)
    """
    required_module = 'lms'
    queryset = Assignment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return AssignmentCreateSerializer
        return AssignmentReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'academic_year', 'class_obj', 'subject', 'teacher',
        ).prefetch_related('attachments').annotate(
            submission_count=Count('submissions'),
        ).order_by('-due_date', '-id')

        # Filter by class
        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by subject
        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)

        # Filter by teacher
        teacher_id = self.request.query_params.get('teacher_id')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)

        # Filter by status
        assignment_status = self.request.query_params.get('status')
        if assignment_status:
            queryset = queryset.filter(status=assignment_status)

        # Filter by academic year
        academic_year_id = self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        return queryset

    def perform_create(self, serializer):
        """Auto-resolve academic year if not provided."""
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            school_id = (
                ensure_tenant_school_id(self.request)
                or self.request.user.school_id
            )
            academic_year = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()

        super().perform_create(serializer)

        if academic_year and not serializer.validated_data.get('academic_year'):
            instance = serializer.instance
            instance.academic_year = academic_year
            instance.save(update_fields=['academic_year'])

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """
        Publish a draft assignment so students can see and submit to it.

        POST /api/lms/assignments/{id}/publish/
        """
        assignment = self.get_object()

        if assignment.status == Assignment.Status.PUBLISHED:
            return Response(
                {'error': 'Assignment is already published.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if assignment.status == Assignment.Status.CLOSED:
            return Response(
                {'error': 'Cannot publish a closed assignment.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.status = Assignment.Status.PUBLISHED
        assignment.save(update_fields=['status', 'updated_at'])

        logger.info(
            f"Assignment {assignment.id} '{assignment.title}' published by "
            f"{request.user.email}"
        )

        serializer = AssignmentReadSerializer(assignment)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """
        Close an assignment so no more submissions are accepted.

        POST /api/lms/assignments/{id}/close/
        """
        assignment = self.get_object()

        if assignment.status == Assignment.Status.CLOSED:
            return Response(
                {'error': 'Assignment is already closed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if assignment.status == Assignment.Status.DRAFT:
            return Response(
                {'error': 'Cannot close a draft assignment. Publish it first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.status = Assignment.Status.CLOSED
        assignment.save(update_fields=['status', 'updated_at'])

        logger.info(
            f"Assignment {assignment.id} '{assignment.title}' closed by "
            f"{request.user.email}"
        )

        serializer = AssignmentReadSerializer(assignment)
        return Response(serializer.data)


class AssignmentSubmissionViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for assignment submissions.

    - Students can create submissions for published assignments in their class.
    - Teachers/admins can list, view, and grade submissions.
    - `grade` action sets marks, feedback, and changes status to GRADED.

    Supports nested access:
        GET  /api/lms/assignments/{assignment_id}/submissions/
        POST /api/lms/assignments/{assignment_id}/submissions/

    And flat access:
        GET  /api/lms/submissions/
        GET  /api/lms/submissions/{id}/
    """
    required_module = 'lms'
    queryset = AssignmentSubmission.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create',):
            return AssignmentSubmissionCreateSerializer
        return AssignmentSubmissionReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'assignment', 'student', 'school', 'graded_by',
        )

        # Nested route: filter by assignment_id from URL
        assignment_id = self.kwargs.get('assignment_id')
        if assignment_id:
            queryset = queryset.filter(assignment_id=assignment_id)

        # Filter by assignment via query param
        assignment_param = self.request.query_params.get('assignment_id')
        if assignment_param:
            queryset = queryset.filter(assignment_id=assignment_param)

        # Filter by student
        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        # Filter by status
        submission_status = self.request.query_params.get('status')
        if submission_status:
            queryset = queryset.filter(status=submission_status)

        return queryset

    def perform_create(self, serializer):
        """
        When creating via the nested route, auto-populate the assignment FK.
        Also set the school from the assignment if not explicitly provided.
        """
        assignment_id = self.kwargs.get('assignment_id')
        extra_kwargs = {}

        if assignment_id and not serializer.validated_data.get('assignment'):
            from .models import Assignment
            try:
                assignment = Assignment.objects.get(id=assignment_id)
                extra_kwargs['assignment'] = assignment
                if not serializer.validated_data.get('school'):
                    extra_kwargs['school_id'] = assignment.school_id
            except Assignment.DoesNotExist:
                pass

        # Determine if submission is late
        assignment = serializer.validated_data.get('assignment') or extra_kwargs.get('assignment')
        if assignment and timezone.now() > assignment.due_date:
            extra_kwargs['status'] = AssignmentSubmission.Status.LATE

        if extra_kwargs:
            serializer.save(**extra_kwargs)
        else:
            super().perform_create(serializer)

    @action(detail=True, methods=['patch'])
    def grade(self, request, pk=None):
        """
        Grade a submission: set marks_obtained, feedback, graded_by, graded_at.

        PATCH /api/lms/submissions/{id}/grade/
        Body: { "marks_obtained": 85.5, "feedback": "Great work!" }
        """
        submission = self.get_object()

        marks_obtained = request.data.get('marks_obtained')
        feedback = request.data.get('feedback', '')

        if marks_obtained is None:
            return Response(
                {'error': 'marks_obtained is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate marks against assignment total
        if submission.assignment.total_marks is not None:
            try:
                marks_val = float(marks_obtained)
                if marks_val < 0:
                    return Response(
                        {'error': 'marks_obtained cannot be negative.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if marks_val > float(submission.assignment.total_marks):
                    return Response(
                        {'error': f'marks_obtained cannot exceed total marks ({submission.assignment.total_marks}).'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            except (ValueError, TypeError):
                return Response(
                    {'error': 'marks_obtained must be a valid number.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Resolve graded_by from the request user's staff profile
        graded_by = None
        if hasattr(request.user, 'staff_profile'):
            graded_by = request.user.staff_profile

        submission.marks_obtained = marks_obtained
        submission.feedback = feedback
        submission.graded_by = graded_by
        submission.graded_at = timezone.now()
        submission.status = AssignmentSubmission.Status.GRADED
        submission.save(update_fields=[
            'marks_obtained', 'feedback', 'graded_by',
            'graded_at', 'status',
        ])

        logger.info(
            f"Submission {submission.id} graded: {marks_obtained} marks by "
            f"{request.user.email}"
        )

        serializer = AssignmentSubmissionReadSerializer(submission)
        return Response(serializer.data)
