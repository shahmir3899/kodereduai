from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.permissions import CanManageStudentExit, HasSchoolAccess, ModuleAccessMixin
from schools.models import School
from students.models import Student

from . import services
from .models import ExitClearanceItem, StudentExit
from .serializers import (
    ReasonSerializer, StartExitSerializer, StudentExitSerializer, UpdateExitSerializer,
)


class StudentExitViewSet(
    ModuleAccessMixin, TenantQuerySetMixin,
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet,
):
    """A student's exit case: start it, work the clearance checklist, then
    finalize (or cancel). Principal and school admins only."""

    required_module = 'students'
    queryset = StudentExit.objects.select_related(
        'student', 'destination_school', 'requested_by', 'finalized_by',
    ).prefetch_related('items__waived_by')
    serializer_class = StudentExitSerializer
    permission_classes = [IsAuthenticated, CanManageStudentExit, HasSchoolAccess]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        if params.get('student'):
            queryset = queryset.filter(student_id=params['student'])
        if params.get('status'):
            queryset = queryset.filter(status=params['status'])
        return queryset

    def _respond(self, exit_case, http_status=status.HTTP_200_OK):
        exit_case = self.get_queryset().get(pk=exit_case.pk)
        return Response(StudentExitSerializer(exit_case).data, status=http_status)

    @staticmethod
    def _error(exc):
        return Response(exc.payload, status=status.HTTP_400_BAD_REQUEST)

    def create(self, request):
        serializer = StartExitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'detail': 'Select a school first.'}, status=status.HTTP_400_BAD_REQUEST)
        student = get_object_or_404(Student, pk=data['student'], school_id=school_id)

        destination = None
        if data['destination_school'] is not None:
            destination = School.objects.filter(pk=data['destination_school']).first()
            if destination is None:
                return Response({'detail': 'Destination school not found.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            exit_case = services.open_exit(
                student=student, exit_type=data['exit_type'], leaving_date=data['leaving_date'],
                reason=data['reason'], destination_school=destination,
                remove_records=data['remove_records_after_leaving'], user=request.user,
            )
        except services.ExitError as exc:
            return self._error(exc)
        return self._respond(exit_case, status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        exit_case = self.get_object()
        serializer = UpdateExitSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        destination_given = 'destination_school' in data
        destination = None
        if destination_given and data['destination_school'] is not None:
            destination = School.objects.filter(pk=data['destination_school']).first()
            if destination is None:
                return Response({'detail': 'Destination school not found.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            services.update_exit(
                exit_case, leaving_date=data.get('leaving_date'), reason=data.get('reason'),
                destination_school=destination, destination_given=destination_given,
                remove_records=data.get('remove_records_after_leaving'),
            )
            services.refresh_clearance(exit_case)
        except services.ExitError as exc:
            return self._error(exc)
        return self._respond(exit_case)

    @action(detail=False, methods=['get'])
    def destinations(self, request):
        """Other active schools of this school's organization: where a student can transfer to."""
        school_id = ensure_tenant_school_id(request)
        school = School.objects.filter(pk=school_id).first() if school_id else None
        if school is None or not school.organization_id:
            return Response([])
        schools = (
            School.objects.filter(organization_id=school.organization_id, is_active=True)
            .exclude(pk=school.pk).order_by('name')
        )
        return Response([{'id': s.id, 'name': s.name} for s in schools])

    @action(detail=True, methods=['post'])
    def refresh(self, request, pk=None):
        exit_case = self.get_object()
        if exit_case.status != StudentExit.Status.OPEN:
            return Response({'detail': 'This exit is no longer open.'}, status=status.HTTP_400_BAD_REQUEST)
        services.refresh_clearance(exit_case)
        return self._respond(exit_case)

    @action(detail=True, methods=['post'], url_path=r'items/(?P<kind>[A-Z_]+)/waive')
    def waive(self, request, pk=None, kind=None):
        exit_case = self.get_object()
        if kind not in ExitClearanceItem.Kind.values:
            return Response({'detail': 'Unknown clearance item.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.waive_item(exit_case, kind, serializer.validated_data['reason'], request.user)
        except services.ExitError as exc:
            return self._error(exc)
        return self._respond(exit_case)

    @action(detail=True, methods=['post'], url_path=r'items/(?P<kind>[A-Z_]+)/unwaive')
    def unwaive(self, request, pk=None, kind=None):
        exit_case = self.get_object()
        if kind not in ExitClearanceItem.Kind.values:
            return Response({'detail': 'Unknown clearance item.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            services.unwaive_item(exit_case, kind)
        except services.ExitError as exc:
            return self._error(exc)
        return self._respond(exit_case)

    @action(detail=True, methods=['post'])
    def finalize(self, request, pk=None):
        exit_case = self.get_object()
        try:
            services.finalize_exit(exit_case, request.user, request=request)
        except services.ExitError as exc:
            return self._error(exc)
        return self._respond(exit_case)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        exit_case = self.get_object()
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.cancel_exit(exit_case, request.user, serializer.validated_data['reason'], request=request)
        except services.ExitError as exc:
            return self._error(exc)
        return self._respond(exit_case)
