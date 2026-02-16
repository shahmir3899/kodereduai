"""
Admission views: sessions, enquiries, documents, notes, analytics, and followups.
"""

from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from .models import AdmissionSession, AdmissionEnquiry, AdmissionDocument, AdmissionNote
from .serializers import (
    AdmissionSessionSerializer,
    AdmissionEnquiryListSerializer,
    AdmissionEnquiryDetailSerializer,
    AdmissionEnquiryCreateSerializer,
    AdmissionEnquiryStageSerializer,
    AdmissionEnquiryConvertSerializer,
    AdmissionDocumentSerializer,
    AdmissionNoteSerializer,
)


def _resolve_school_id(request):
    """Resolve the active school id from header / params / user fallback."""
    sid = ensure_tenant_school_id(request)
    if sid:
        return sid
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


# ── Admission Session ────────────────────────────────────────

class AdmissionSessionViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for admission session windows (admin only)."""
    required_module = 'admissions'
    queryset = AdmissionSession.objects.all()
    serializer_class = AdmissionSessionSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'academic_year',
        )

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if school_id:
            serializer.save(school_id=school_id)
        else:
            serializer.save()

    @action(detail=False, methods=['get'], url_path='active')
    def active_sessions(self, request):
        """Return only currently active admission sessions."""
        queryset = self.get_queryset().filter(is_active=True)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


# ── Admission Enquiry ────────────────────────────────────────

class AdmissionEnquiryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD + stage transitions + conversion for admission enquiries."""
    required_module = 'admissions'
    queryset = AdmissionEnquiry.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'list':
            return AdmissionEnquiryListSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return AdmissionEnquiryCreateSerializer
        if self.action == 'update_stage':
            return AdmissionEnquiryStageSerializer
        if self.action == 'convert':
            return AdmissionEnquiryConvertSerializer
        return AdmissionEnquiryDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'session',
            'assigned_to', 'converted_student',
        )

        if self.action == 'retrieve':
            queryset = queryset.prefetch_related('documents').annotate(
                notes_count=Count('activity_notes'),
            )
        elif self.action == 'list':
            queryset = queryset.annotate(
                notes_count=Count('activity_notes'),
            )

        # ── Filters ──
        params = self.request.query_params

        stage = params.get('stage')
        if stage:
            queryset = queryset.filter(stage=stage.upper())

        grade_level = params.get('grade_level')
        if grade_level:
            queryset = queryset.filter(applying_for_grade_level=grade_level)

        source = params.get('source')
        if source:
            queryset = queryset.filter(source=source.upper())

        priority = params.get('priority')
        if priority:
            queryset = queryset.filter(priority=priority.upper())

        assigned_to = params.get('assigned_to')
        if assigned_to:
            queryset = queryset.filter(assigned_to_id=assigned_to)

        date_from = params.get('date_from')
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)

        date_to = params.get('date_to')
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        search = params.get('search')
        if search:
            queryset = queryset.filter(
                Q(child_name__icontains=search) |
                Q(parent_name__icontains=search) |
                Q(parent_phone__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        extra = {}
        if school_id:
            extra['school_id'] = school_id
        instance = serializer.save(**extra)

        # Auto-create a system note for new enquiry
        AdmissionNote.objects.create(
            enquiry=instance,
            user=self.request.user,
            note=f"Enquiry created for {instance.child_name}",
            note_type='SYSTEM',
        )

    # ── Stage Transition ─────────────────────────────────────

    @action(detail=True, methods=['patch'], url_path='update-stage')
    def update_stage(self, request, pk=None):
        """Move enquiry to a new pipeline stage and auto-log a note."""
        enquiry = self.get_object()
        serializer = AdmissionEnquiryStageSerializer(
            instance=enquiry,
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(AdmissionEnquiryDetailSerializer(updated).data)

    # ── Convert to Student ───────────────────────────────────

    @action(detail=True, methods=['post'], url_path='convert')
    def convert(self, request, pk=None):
        """Convert an accepted enquiry into a Student record."""
        enquiry = self.get_object()

        if enquiry.converted_student is not None:
            return Response(
                {'detail': 'This enquiry has already been converted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AdmissionEnquiryConvertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        class_id = serializer.validated_data['class_id']
        roll_number = serializer.validated_data['roll_number']

        from students.models import Student, Class as StudentClass

        # Validate the class belongs to the same school
        try:
            class_obj = StudentClass.objects.get(
                id=class_id, school_id=enquiry.school_id,
            )
        except StudentClass.DoesNotExist:
            return Response(
                {'detail': 'Class not found in this school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check duplicate roll number
        if Student.objects.filter(
            school_id=enquiry.school_id, class_obj=class_obj, roll_number=roll_number,
        ).exists():
            return Response(
                {'detail': f"Roll number '{roll_number}' already exists in this class."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            student = Student.objects.create(
                school_id=enquiry.school_id,
                class_obj=class_obj,
                roll_number=roll_number,
                name=enquiry.child_name,
                date_of_birth=enquiry.child_dob,
                gender=enquiry.child_gender or '',
                parent_name=enquiry.parent_name,
                parent_phone=enquiry.parent_phone,
                guardian_email=enquiry.parent_email,
                guardian_occupation=enquiry.parent_occupation,
                address=enquiry.address,
                previous_school=enquiry.previous_school,
                admission_date=date.today(),
            )

            enquiry.stage = 'ENROLLED'
            enquiry.converted_student = student
            enquiry.save(update_fields=['stage', 'converted_student', 'updated_at'])

            AdmissionNote.objects.create(
                enquiry=enquiry,
                user=request.user,
                note=f"Converted to student #{student.id} (Roll: {roll_number}, Class: {class_obj.name})",
                note_type='STATUS_CHANGE',
            )

        from students.serializers import StudentSerializer
        return Response({
            'detail': 'Enquiry converted to student successfully.',
            'student': StudentSerializer(student).data,
            'enquiry': AdmissionEnquiryDetailSerializer(enquiry).data,
        }, status=status.HTTP_201_CREATED)


# ── Admission Document ───────────────────────────────────────

class AdmissionDocumentViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for documents attached to an admission enquiry."""
    required_module = 'admissions'
    queryset = AdmissionDocument.objects.all()
    serializer_class = AdmissionDocumentSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_queryset(self):
        queryset = super().get_queryset()
        enquiry_pk = self.kwargs.get('enquiry_pk')
        if enquiry_pk:
            queryset = queryset.filter(enquiry_id=enquiry_pk)

        # Tenant isolation: only documents for enquiries belonging to the school
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(enquiry__school_id=school_id)

        return queryset

    def perform_create(self, serializer):
        enquiry_pk = self.kwargs.get('enquiry_pk')
        if enquiry_pk:
            serializer.save(enquiry_id=enquiry_pk)
        else:
            serializer.save()


# ── Admission Note ───────────────────────────────────────────

class AdmissionNoteViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for notes / activity log on an admission enquiry."""
    required_module = 'admissions'
    queryset = AdmissionNote.objects.all()
    serializer_class = AdmissionNoteSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_queryset(self):
        queryset = super().get_queryset().select_related('user')
        enquiry_pk = self.kwargs.get('enquiry_pk')
        if enquiry_pk:
            queryset = queryset.filter(enquiry_id=enquiry_pk)

        # Tenant isolation
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(enquiry__school_id=school_id)

        return queryset

    def perform_create(self, serializer):
        extra = {'user': self.request.user}
        enquiry_pk = self.kwargs.get('enquiry_pk')
        if enquiry_pk:
            extra['enquiry_id'] = enquiry_pk
        serializer.save(**extra)


# ── Analytics ────────────────────────────────────────────────

class AdmissionAnalyticsView(ModuleAccessMixin, APIView):
    """Admission pipeline analytics: funnel, sources, conversion, trends."""
    required_module = 'admissions'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        base_qs = AdmissionEnquiry.objects.filter(school_id=school_id)

        # Total enquiries
        total_enquiries = base_qs.count()

        # Pipeline funnel: count per stage
        pipeline_funnel = list(
            base_qs.values('stage')
            .annotate(count=Count('id'))
            .order_by('stage')
        )

        # Source breakdown
        source_breakdown = list(
            base_qs.values('source')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # Conversion rate
        enrolled_count = base_qs.filter(stage='ENROLLED').count()
        conversion_rate = round(
            (enrolled_count / total_enquiries * 100) if total_enquiries > 0 else 0.0,
            2,
        )

        # Monthly trend (last 6 months)
        six_months_ago = date.today() - timedelta(days=180)
        monthly_trend = list(
            base_qs.filter(created_at__date__gte=six_months_ago)
            .annotate(month=TruncMonth('created_at'))
            .values('month')
            .annotate(count=Count('id'))
            .order_by('month')
        )

        return Response({
            'total_enquiries': total_enquiries,
            'pipeline_funnel': pipeline_funnel,
            'source_breakdown': source_breakdown,
            'conversion_rate': conversion_rate,
            'monthly_trend': monthly_trend,
        })


# ── Followups ────────────────────────────────────────────────

class FollowupView(ModuleAccessMixin, APIView):
    """Followup reminders: today's and overdue followups."""
    required_module = 'admissions'
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get(self, request, followup_type=None):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        base_qs = AdmissionEnquiry.objects.filter(
            school_id=school_id,
        ).exclude(
            stage__in=['ENROLLED', 'REJECTED', 'WITHDRAWN', 'LOST'],
        ).select_related('assigned_to')

        today = date.today()

        if followup_type == 'today':
            queryset = base_qs.filter(next_followup_date=today)
        elif followup_type == 'overdue':
            queryset = base_qs.filter(next_followup_date__lt=today)
        else:
            return Response(
                {'detail': 'Invalid followup type. Use "today" or "overdue".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AdmissionEnquiryListSerializer(queryset, many=True)
        return Response(serializer.data)
