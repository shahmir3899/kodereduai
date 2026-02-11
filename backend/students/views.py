"""
Student and Class views.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count

from core.permissions import IsSchoolAdmin, HasSchoolAccess
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools
from .models import Class, Student
from .serializers import (
    ClassSerializer,
    ClassCreateSerializer,
    StudentSerializer,
    StudentCreateSerializer,
    StudentBulkCreateSerializer,
)


class ClassViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing classes within a school.
    """
    queryset = Class.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return ClassCreateSerializer
        return ClassSerializer

    def get_queryset(self):
        # Note: Don't annotate student_count here - the model has a @property for it
        queryset = Class.objects.select_related('school')

        # Apply tenant filtering (ensure_tenant_schools handles JWT auth timing)
        user = self.request.user
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filter by school if provided
        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset.order_by('grade_level', 'name')

    def perform_create(self, serializer):
        """Set school_id from request if not provided."""
        school_id = self.request.data.get('school')
        if not school_id and self.request.user.school_id:
            serializer.save(school_id=self.request.user.school_id)
        else:
            serializer.save()


# Need to import models for the Q object
from django.db import models


class StudentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing students within a school.
    """
    queryset = Student.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return StudentCreateSerializer
        if self.action == 'bulk_create':
            return StudentBulkCreateSerializer
        return StudentSerializer

    def get_queryset(self):
        queryset = Student.objects.select_related('school', 'class_obj')

        # Apply tenant filtering (ensure_tenant_schools handles JWT auth timing)
        user = self.request.user
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filter by school if provided
        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        # Filter by class if provided
        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Search by name or roll number
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                models.Q(name__icontains=search) |
                models.Q(roll_number__icontains=search)
            )

        return queryset.order_by('class_obj__grade_level', 'class_obj__name', 'roll_number')

    def perform_create(self, serializer):
        """Set school_id from request if not provided."""
        school_id = self.request.data.get('school')
        if not school_id and self.request.user.school_id:
            serializer.save(school_id=self.request.user.school_id)
        else:
            serializer.save()

    @action(detail=False, methods=['post'])
    def bulk_create(self, request):
        """Bulk create students for a class."""
        serializer = StudentBulkCreateSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        result = serializer.save()

        all_students = result['created'] + result.get('updated', [])
        return Response({
            'created_count': len(result['created']),
            'updated_count': len(result.get('updated', [])),
            'errors': result['errors'],
            'students': StudentSerializer(all_students, many=True).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        """Get students grouped by class."""
        school_id = request.query_params.get('school_id') or request.user.school_id

        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        classes = Class.objects.filter(
            school_id=school_id,
            is_active=True
        ).prefetch_related(
            models.Prefetch(
                'students',
                queryset=Student.objects.filter(is_active=True).order_by('roll_number')
            )
        ).order_by('grade_level', 'name')

        result = []
        for cls in classes:
            result.append({
                'class': ClassSerializer(cls).data,
                'students': StudentSerializer(cls.students.all(), many=True).data
            })

        return Response(result)
