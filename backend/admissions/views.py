"""
Simplified admission views: enquiries CRUD, status updates, batch conversion,
notes, and followups.
"""

from datetime import date

from django.db import transaction
from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from .models import AdmissionEnquiry, AdmissionNote
from .serializers import (
    EnquiryListSerializer,
    EnquiryDetailSerializer,
    EnquiryCreateSerializer,
    EnquiryStatusSerializer,
    BatchConvertSerializer,
    AdmissionNoteSerializer,
)


def _resolve_school_id(request):
    """Resolve the active school id from header / params / user fallback."""
    sid = ensure_tenant_school_id(request)
    if sid:
        return sid
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


# -- Enquiry ViewSet --

class AdmissionEnquiryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD + status updates + batch conversion for admission enquiries."""
    required_module = 'admissions'
    queryset = AdmissionEnquiry.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action == 'list':
            return EnquiryListSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return EnquiryCreateSerializer
        if self.action == 'update_status':
            return EnquiryStatusSerializer
        if self.action == 'batch_convert':
            return BatchConvertSerializer
        return EnquiryDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('school', 'converted_student')

        if self.action == 'retrieve':
            queryset = queryset.prefetch_related('activity_notes__user')

        params = self.request.query_params

        status_filter = params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter.upper())

        grade_level = params.get('grade_level')
        if grade_level:
            queryset = queryset.filter(applying_for_grade_level=grade_level)

        source = params.get('source')
        if source:
            queryset = queryset.filter(source=source.upper())

        date_from = params.get('date_from')
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)

        date_to = params.get('date_to')
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        search = params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(father_name__icontains=search)
                | Q(mobile__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        extra = {}
        if school_id:
            extra['school_id'] = school_id
        instance = serializer.save(**extra)

        AdmissionNote.objects.create(
            enquiry=instance,
            user=self.request.user,
            note=f"Enquiry created for {instance.name}",
            note_type='SYSTEM',
        )

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Change enquiry status (NEW -> CONFIRMED, any -> CANCELLED, etc.)."""
        enquiry = self.get_object()
        serializer = EnquiryStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        old_status = enquiry.get_status_display()
        new_status_code = serializer.validated_data['status']

        if enquiry.status == 'CONVERTED':
            return Response(
                {'detail': 'Cannot change status of a converted enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        enquiry.status = new_status_code
        enquiry.save(update_fields=['status', 'updated_at'])

        new_status = enquiry.get_status_display()
        note_text = serializer.validated_data.get('note', '')
        log_msg = f"Status changed from {old_status} to {new_status}"
        if note_text:
            log_msg += f": {note_text}"

        AdmissionNote.objects.create(
            enquiry=enquiry,
            user=request.user,
            note=log_msg,
            note_type='STATUS_CHANGE',
        )

        return Response(EnquiryDetailSerializer(enquiry).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='batch-convert')
    def batch_convert(self, request):
        """Convert multiple CONFIRMED enquiries into Student + StudentEnrollment.
        Optionally generate fee records (ADMISSION, ANNUAL, BOOKS, MONTHLY).
        """
        serializer = BatchConvertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        enquiry_ids = serializer.validated_data['enquiry_ids']
        academic_year_id = serializer.validated_data['academic_year_id']
        class_id = serializer.validated_data['class_id']
        generate_fees = serializer.validated_data.get('generate_fees', False)
        fee_types_to_generate = serializer.validated_data.get('fee_types', [])

        from students.models import Student, Class as StudentClass
        from academic_sessions.models import StudentEnrollment, AcademicYear

        school_id = _resolve_school_id(request)

        try:
            class_obj = StudentClass.objects.get(id=class_id, school_id=school_id)
        except StudentClass.DoesNotExist:
            return Response(
                {'detail': 'Class not found in this school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id, school_id=school_id)
        except AcademicYear.DoesNotExist:
            return Response(
                {'detail': 'Academic year not found in this school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        enquiries = AdmissionEnquiry.objects.filter(
            id__in=enquiry_ids,
            school_id=school_id,
            status='CONFIRMED',
        )

        if not enquiries.exists():
            return Response(
                {'detail': 'No confirmed enquiries found with the given IDs.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_students = []
        errors_list = []
        fees_generated_count = 0

        # Calculate max roll from StudentEnrollment for the TARGET year only
        # Roll numbers are session-scoped — uniqueness is per (school, year, class)
        existing_rolls = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year=academic_year,
            class_obj=class_obj,
        ).values_list('roll_number', flat=True)

        max_roll = 0
        for r in existing_rolls:
            try:
                max_roll = max(max_roll, int(r))
            except (ValueError, TypeError):
                pass

        for enquiry in enquiries:
            max_roll += 1
            roll_number = str(max_roll)

            try:
                with transaction.atomic():
                    student = Student.objects.create(
                        school_id=school_id,
                        class_obj=class_obj,
                        roll_number=roll_number,
                        name=enquiry.name,
                        parent_name=enquiry.father_name,
                        parent_phone=enquiry.mobile,
                        admission_date=date.today(),
                    )

                    StudentEnrollment.objects.create(
                        school_id=school_id,
                        student=student,
                        academic_year=academic_year,
                        class_obj=class_obj,
                        roll_number=roll_number,
                        status='ACTIVE',
                    )

                    enquiry.status = 'CONVERTED'
                    enquiry.converted_student = student
                    enquiry.save(update_fields=['status', 'converted_student', 'updated_at'])

                    AdmissionNote.objects.create(
                        enquiry=enquiry,
                        user=request.user,
                        note=f"Converted to student #{student.id} (Roll: {roll_number}, Class: {class_obj.name})",
                        note_type='STATUS_CHANGE',
                    )

                    # Generate fee records if requested
                    student_fees = []
                    if generate_fees and fee_types_to_generate:
                        from finance.models import FeePayment, resolve_fee_amount
                        current_date = date.today()

                        for ft in fee_types_to_generate:
                            m = current_date.month if ft == 'MONTHLY' else 0
                            y = current_date.year

                            amount = resolve_fee_amount(student, ft)
                            if amount is not None:
                                FeePayment.objects.create(
                                    school_id=school_id,
                                    student=student,
                                    fee_type=ft,
                                    month=m,
                                    year=y,
                                    amount_due=amount,
                                    amount_paid=0,
                                )
                                fees_generated_count += 1
                                student_fees.append(ft)

                    created_students.append({
                        'enquiry_id': enquiry.id,
                        'student_id': student.id,
                        'name': student.name,
                        'roll_number': roll_number,
                        'fees_generated': student_fees,
                    })
            except Exception as e:
                errors_list.append({
                    'enquiry_id': enquiry.id,
                    'name': enquiry.name,
                    'error': str(e),
                })

        fee_msg = f' ({fees_generated_count} fee records created)' if fees_generated_count else ''
        resp_status = status.HTTP_201_CREATED if created_students else status.HTTP_400_BAD_REQUEST
        return Response(
            {
                'detail': f'{len(created_students)} students created successfully.{fee_msg}',
                'converted': created_students,
                'converted_count': len(created_students),
                'fees_generated_count': fees_generated_count,
                'errors': errors_list,
            },
            status=resp_status,
        )


# -- Admission Note ViewSet --

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


# -- Followups --

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
            status__in=['CONVERTED', 'CANCELLED'],
        )

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

        serializer = EnquiryListSerializer(queryset, many=True)
        return Response(serializer.data)
