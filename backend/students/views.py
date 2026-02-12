"""
Student, Class, and Grade views.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count

from core.permissions import IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from .models import Grade, Class, Student
from .serializers import (
    GradeSerializer,
    GradeCreateSerializer,
    ClassSerializer,
    ClassCreateSerializer,
    StudentSerializer,
    StudentCreateSerializer,
    StudentBulkCreateSerializer,
)


def _resolve_school_id(request):
    school_id = ensure_tenant_school_id(request)
    if school_id:
        return school_id
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


class GradeViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = Grade.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return GradeCreateSerializer
        return GradeSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school')
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=True, methods=['get'])
    def classes(self, request, pk=None):
        grade = self.get_object()
        classes = Class.objects.filter(grade=grade, is_active=True).order_by('section')
        return Response(ClassSerializer(classes, many=True).data)


class ClassViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = Class.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ClassCreateSerializer
        return ClassSerializer

    def get_queryset(self):
        queryset = Class.objects.select_related('school', 'grade')

        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        grade_id = self.request.query_params.get('grade_id')
        if grade_id:
            queryset = queryset.filter(grade_id=grade_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset.order_by('grade_level', 'name')

    def perform_create(self, serializer):
        school_id = self.request.data.get('school')
        if not school_id:
            school_id = ensure_tenant_school_id(self.request) or self.request.user.school_id
        if school_id:
            serializer.save(school_id=school_id)
        else:
            serializer.save()


from django.db import models as db_models


class StudentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
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

        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                db_models.Q(name__icontains=search) |
                db_models.Q(roll_number__icontains=search)
            )

        return queryset.order_by('class_obj__grade_level', 'class_obj__name', 'roll_number')

    def perform_create(self, serializer):
        school_id = self.request.data.get('school')
        if not school_id:
            school_id = ensure_tenant_school_id(self.request) or self.request.user.school_id
        if school_id:
            serializer.save(school_id=school_id)
        else:
            serializer.save()

    @action(detail=False, methods=['post'])
    def bulk_create(self, request):
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
        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id

        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        classes = Class.objects.filter(
            school_id=school_id,
            is_active=True
        ).prefetch_related(
            db_models.Prefetch(
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
