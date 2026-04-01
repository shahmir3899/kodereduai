import io
from decimal import Decimal
from django.db.models import Count, Q
from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.permissions import IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin

from .models import (
    ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale,
    Question, ExamPaper, PaperQuestion, PaperUpload, PaperFeedback
)
from .serializers import (
    ExamTypeSerializer, ExamTypeCreateSerializer,
    ExamSerializer, ExamCreateSerializer,
    ExamSubjectSerializer, ExamSubjectCreateSerializer,
    StudentMarkSerializer, StudentMarkCreateSerializer,
    StudentMarkBulkEntrySerializer,
    GradeScaleSerializer, GradeScaleCreateSerializer,
    ExamGroupSerializer, ExamGroupCreateSerializer,
    ExamGroupWizardCreateSerializer, DateSheetUpdateSerializer,
    QuestionSerializer, QuestionCreateUpdateSerializer,
    ExamPaperSerializer, ExamPaperCreateUpdateSerializer,
    PaperUploadSerializer, PaperUploadCreateSerializer,
    PaperFeedbackSerializer, QuestionReviewSerializer,
)



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


class ExamGroupViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = ExamGroup.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

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
        instance.delete()  # Cascades to Exam → ExamSubject → StudentMark

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

        class_ids = data['class_ids']
        valid_classes = list(Class.objects.filter(
            school_id=school_id, id__in=class_ids, is_active=True,
        ))
        if len(valid_classes) != len(class_ids):
            return Response(
                {'detail': 'One or more class IDs are invalid.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for conflicts (only active exams block new creation)
        conflicts = []
        for cls in valid_classes:
            existing = Exam.objects.filter(
                school_id=school_id,
                exam_type_id=data['exam_type'],
                class_obj=cls,
                term_id=data.get('term'),
                is_active=True,
            ).first()
            if existing:
                conflicts.append({
                    'class_id': cls.id,
                    'class_name': cls.name,
                    'existing_exam': existing.name,
                })
        if conflicts:
            return Response({
                'detail': 'Some classes already have an active exam of this type for this term.',
                'conflicts': conflicts,
            }, status=status.HTTP_409_CONFLICT)

        # Build lookup: (class_id, subject_id) -> {exam_date, start_time, end_time}
        date_sheet_list = data.get('date_sheet', [])
        date_sheet_map = {}
        for entry in date_sheet_list:
            class_id = entry.get('class_id')
            subject_id = entry.get('subject_id')
            if class_id and subject_id:
                date_sheet_map[(int(class_id), int(subject_id))] = {
                    'exam_date': entry.get('exam_date'),
                    'start_time': entry.get('start_time'),
                    'end_time': entry.get('end_time'),
                }

        default_total = data.get('default_total_marks', 100)
        default_passing = data.get('default_passing_marks', 33)

        with transaction.atomic():
            group = ExamGroup.objects.create(
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
            for cls in valid_classes:
                exam = Exam.objects.create(
                    school_id=school_id,
                    academic_year_id=data['academic_year'],
                    term_id=data.get('term'),
                    exam_type_id=data['exam_type'],
                    class_obj=cls,
                    exam_group=group,
                    name=f"{data['name']} - {cls.name}",
                    start_date=data.get('start_date'),
                    end_date=data.get('end_date'),
                    status=Exam.Status.SCHEDULED,
                )
                created_exams.append(exam)

            all_exam_subjects = []
            for exam in created_exams:
                class_subjects = ClassSubject.objects.filter(
                    school_id=school_id,
                    class_obj=exam.class_obj,
                    is_active=True,
                ).select_related('subject')
                for cs in class_subjects:
                    slot = date_sheet_map.get((exam.class_obj_id, cs.subject_id), {})
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
        """Generate and return an Excel date sheet."""
        group = self.get_object()
        school_id = _resolve_school_id(request)

        exam_subjects = ExamSubject.objects.filter(
            exam__exam_group=group, exam__is_active=True,
            is_active=True, school_id=school_id,
        ).select_related('subject', 'exam__class_obj').order_by(
            'exam_date', 'subject__name',
        )

        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Date Sheet'

        ws.merge_cells('A1:G1')
        ws['A1'] = f'Date Sheet - {group.name}'
        ws['A1'].font = Font(bold=True, size=14)

        ws.merge_cells('A2:G2')
        period = ''
        if group.start_date and group.end_date:
            period = f' | {group.start_date} to {group.end_date}'
        ws['A2'] = f'Exam Type: {group.exam_type.name}{period}'
        ws['A2'].font = Font(size=10, color='555555')

        header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
        header_font = Font(bold=True, color='FFFFFF', size=10)
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin'),
        )
        flat_rows = []
        for es in exam_subjects:
            flat_rows.append({
                'subject_name': es.subject.name,
                'subject_code': es.subject.code,
                'class_name': es.exam.class_obj.name,
                'exam_date': es.exam_date,
                'start_time': es.start_time,
                'end_time': es.end_time,
            })

        flat_rows.sort(key=lambda x: (
            str(x['exam_date'] or '9999-99-99'), x['subject_name'], x['class_name'],
        ))

        # Update headers to include time columns
        headers = ['#', 'Date', 'Subject', 'Code', 'Class', 'Start Time', 'End Time']
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')
            cell.border = thin_border

        for row_idx, row in enumerate(flat_rows, 5):
            def fmt_time(t):
                if not t:
                    return ''
                return t.strftime('%H:%M') if hasattr(t, 'strftime') else str(t)[:5]
            ws.cell(row=row_idx, column=1, value=row_idx - 4).border = thin_border
            ws.cell(row=row_idx, column=2, value=str(row['exam_date'] or 'TBD')).border = thin_border
            ws.cell(row=row_idx, column=3, value=row['subject_name']).border = thin_border
            ws.cell(row=row_idx, column=4, value=row['subject_code']).border = thin_border
            ws.cell(row=row_idx, column=5, value=row['class_name']).border = thin_border
            ws.cell(row=row_idx, column=6, value=fmt_time(row['start_time'])).border = thin_border
            ws.cell(row=row_idx, column=7, value=fmt_time(row['end_time'])).border = thin_border

        ws.column_dimensions['A'].width = 5
        ws.column_dimensions['B'].width = 14
        ws.column_dimensions['C'].width = 25
        ws.column_dimensions['D'].width = 10
        ws.column_dimensions['E'].width = 20
        ws.column_dimensions['F'].width = 12
        ws.column_dimensions['G'].width = 12

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

    @action(detail=True, methods=['post'], url_path='publish-all')
    def publish_all(self, request, pk=None):
        """Publish all exams in the group."""
        group = self.get_object()
        count = group.exams.filter(is_active=True).update(status=Exam.Status.PUBLISHED)
        return Response({'published_count': count})


class ExamViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'examinations'
    queryset = Exam.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ExamCreateSerializer
        return ExamSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'school', 'academic_year', 'term', 'exam_type', 'class_obj', 'exam_group',
        ).annotate(
            subjects_count=Count('exam_subjects', filter=Q(exam_subjects__is_active=True)),
        )
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        term = self.request.query_params.get('term')
        if term:
            qs = qs.filter(term_id=term)
        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            qs = qs.filter(class_obj_id=class_obj)
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
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        super().perform_create(serializer)
        exam = serializer.instance
        # Auto-create ExamSubject entries from the class's assigned subjects
        from academics.models import ClassSubject
        class_subjects = ClassSubject.objects.filter(
            school_id=exam.school_id,
            class_obj=exam.class_obj,
            is_active=True,
        ).select_related('subject')
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

    def perform_destroy(self, instance):
        instance.delete()  # Cascades to ExamSubject → StudentMark

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        exam = self.get_object()
        exam.status = Exam.Status.PUBLISHED
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

        # If force=true, clear existing AI comments first
        if force:
            StudentMark.objects.filter(
                exam_subject__exam=exam,
                school_id=school_id,
            ).update(ai_comment='', ai_comment_generated_at=None)

        from schools.models import School
        school = School.objects.get(id=school_id)

        from .ai_comments_service import ReportCardCommentGenerator
        generator = ReportCardCommentGenerator(school)
        result = generator.generate_for_exam(exam.id)

        return Response(result)

    @action(detail=True, methods=['post'], url_path='populate-subjects')
    def populate_subjects(self, request, pk=None):
        """Re-sync exam subjects from the class's current ClassSubject assignments."""
        exam = self.get_object()
        school_id = _resolve_school_id(request)

        from academics.models import ClassSubject
        class_subjects = ClassSubject.objects.filter(
            school_id=school_id,
            class_obj=exam.class_obj,
            is_active=True,
        ).select_related('subject')

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

        from students.models import Student
        students = Student.objects.filter(
            school_id=school_id,
            class_obj=exam.class_obj,
            is_active=True,
        ).order_by('roll_number')

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

        results = []
        for student in students:
            marks_list = []
            total_obtained = Decimal('0')
            total_possible = Decimal('0')
            all_pass = True

            for es in exam_subjects:
                mark = marks_lookup.get((student.id, es.id))
                obtained = mark.marks_obtained if mark and not mark.is_absent else None
                is_absent = mark.is_absent if mark else False

                marks_list.append({
                    'subject_id': es.subject_id,
                    'subject_name': es.subject.name,
                    'total_marks': float(es.total_marks),
                    'passing_marks': float(es.passing_marks),
                    'marks_obtained': float(obtained) if obtained is not None else None,
                    'is_absent': is_absent,
                    'is_pass': obtained is not None and obtained >= es.passing_marks,
                    'ai_comment': mark.ai_comment if mark else '',
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
                'roll_number': student.roll_number,
                'marks': marks_list,
                'total_obtained': float(total_obtained),
                'total_possible': float(total_possible),
                'percentage': round(percentage, 2),
                'grade': grade_label,
                'is_pass': all_pass,
            })

        # Calculate ranks
        results.sort(key=lambda x: x['percentage'], reverse=True)
        for i, r in enumerate(results):
            r['rank'] = i + 1

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

        from students.models import Student
        students = Student.objects.filter(
            school_id=school_id,
            class_obj=exam.class_obj,
            is_active=True,
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
            'total_students': students.count(),
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
        exam = self.request.query_params.get('exam')
        if exam:
            qs = qs.filter(exam_id=exam)
        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            qs = qs.filter(exam__class_obj_id=class_obj)
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
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StudentMarkCreateSerializer
        return StudentMarkSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'school', 'exam_subject', 'exam_subject__subject',
            'exam_subject__exam', 'student',
        )
        exam_subject = self.request.query_params.get('exam_subject')
        if exam_subject:
            qs = qs.filter(exam_subject_id=exam_subject)
        student = self.request.query_params.get('student')
        if student:
            qs = qs.filter(student_id=student)
        academic_year = self.request.query_params.get('academic_year')
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
        ws.merge_cells('A2:E2')
        ws['A2'] = (
            f'Subject: {exam_subject.subject.name} | '
            f'Class: {exam_subject.exam.class_obj.name} | '
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

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


class ReportCardView(ModuleAccessMixin, APIView):
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

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

        enrollment_qs = StudentEnrollment.objects.select_related('class_obj', 'academic_year').filter(
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

        # Get exams for the class captured in the selected enrollment/session.
        exam_filter = {
            'school_id': school_id,
            'class_obj': enrollment.class_obj,
            'is_active': True,
            'status': Exam.Status.PUBLISHED,
            'academic_year_id': enrollment.academic_year_id,
        }
        if term_id:
            exam_filter['term_id'] = term_id

        exams = Exam.objects.filter(**exam_filter).select_related(
            'exam_type', 'academic_year', 'term',
        ).order_by('start_date')

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
                    'marks_obtained': float(mark.marks_obtained) if mark and mark.marks_obtained else None,
                    'is_absent': mark.is_absent if mark else False,
                    'ai_comment': mark.ai_comment if mark else '',
                }

            exam_data.append({
                'exam_id': exam.id,
                'exam_name': exam.name,
                'exam_type': exam.exam_type.name,
                'term': exam.term.name if exam.term else None,
                'marks': exam_marks,
            })

        # Determine weighted vs simple calculation
        from schools.models import School
        school = School.objects.get(pk=school_id)
        use_weighted = (school.exam_config or {}).get('weighted_average_enabled', False)

        # Calculate overall totals
        grand_total_obtained = Decimal('0')
        grand_total_possible = Decimal('0')

        if use_weighted and exams.count() > 1:
            # Weighted: group by exam_type, compute per-type percentage, apply weights
            exam_type_data = {}
            for exam in exams:
                et_id = exam.exam_type_id
                if et_id not in exam_type_data:
                    exam_type_data[et_id] = {
                        'weight': exam.exam_type.weight,
                        'obtained': Decimal('0'),
                        'possible': Decimal('0'),
                    }
                for es_item in es_by_exam.get(exam.id, []):
                    mark = marks_lookup.get(es_item.id)
                    if mark and mark.marks_obtained is not None and not mark.is_absent:
                        exam_type_data[et_id]['obtained'] += mark.marks_obtained
                    exam_type_data[et_id]['possible'] += es_item.total_marks

            total_weight = sum(d['weight'] for d in exam_type_data.values() if d['possible'] > 0)
            if total_weight > 0:
                weighted_sum = Decimal('0')
                for data in exam_type_data.values():
                    if data['possible'] > 0:
                        type_pct = data['obtained'] / data['possible'] * 100
                        weighted_sum += type_pct * (data['weight'] / total_weight)
                overall_pct = float(weighted_sum)
            else:
                overall_pct = 0

            grand_total_obtained = sum((d['obtained'] for d in exam_type_data.values()), Decimal('0'))
            grand_total_possible = sum((d['possible'] for d in exam_type_data.values()), Decimal('0'))
        else:
            # Simple average
            for es_item in all_exam_subjects:
                mark = marks_lookup.get(es_item.id)
                if mark and mark.marks_obtained is not None and not mark.is_absent:
                    grand_total_obtained += mark.marks_obtained
                grand_total_possible += es_item.total_marks
            overall_pct = float(grand_total_obtained / grand_total_possible * 100) if grand_total_possible > 0 else 0

        overall_grade = '-'
        for gs in grade_scales:
            if float(gs.min_percentage) <= overall_pct <= float(gs.max_percentage):
                overall_grade = gs.grade_label
                break

        # Build flattened subject-level summary for the frontend
        subject_summaries = []
        for subj_id, subj_name in all_subjects.items():
            subj_total = Decimal('0')
            subj_obtained = Decimal('0')
            subj_absent = False
            subj_pass = True

            for exam in exams:
                for es_item in es_by_exam.get(exam.id, []):
                    if es_item.subject_id == subj_id:
                        mark = marks_lookup.get(es_item.id)
                        subj_total += es_item.total_marks
                        if mark and mark.marks_obtained is not None and not mark.is_absent:
                            subj_obtained += mark.marks_obtained
                            if mark.marks_obtained < es_item.passing_marks:
                                subj_pass = False
                        else:
                            subj_pass = False
                            if mark and mark.is_absent:
                                subj_absent = True

            subj_pct = float(subj_obtained / subj_total * 100) if subj_total > 0 else 0
            subj_grade = '-'
            for gs in grade_scales:
                if float(gs.min_percentage) <= subj_pct <= float(gs.max_percentage):
                    subj_grade = gs.grade_label
                    break

            subject_summaries.append({
                'subject_name': subj_name,
                'total_marks': float(subj_total),
                'marks_obtained': float(subj_obtained),
                'percentage': round(subj_pct, 2),
                'grade': subj_grade,
                'is_pass': subj_pass,
                'is_absent': subj_absent,
            })

        return Response({
            'student_name': student.name,
            'roll_number': enrollment.roll_number or student.roll_number,
            'class_name': enrollment.class_obj.name,
            'school_name': student.school.name,
            'academic_year_name': enrollment.academic_year.name,
            'term_name': exams[0].term.name if exams and exams[0].term else None,
            'enrollment_info': {
                'enrollment_id': enrollment.id,
                'class_at_report_session': enrollment.class_obj.name,
                'current_class': student.class_obj.name if student.class_obj else None,
                'academic_year_id': enrollment.academic_year_id,
                'academic_year_name': enrollment.academic_year.name,
            },
            'student': {
                'id': student.id,
                'name': student.name,
                'roll_number': enrollment.roll_number or student.roll_number,
                'class_name': enrollment.class_obj.name,
                'school_name': student.school.name,
            },
            'subjects': subject_summaries,
            'exams': exam_data,
            'summary': {
                'total_marks': float(grand_total_possible),
                'obtained_marks': float(grand_total_obtained),
                'total_obtained': float(grand_total_obtained),
                'total_possible': float(grand_total_possible),
                'percentage': round(overall_pct, 2),
                'grade': overall_grade,
                'overall_pass': all(s['is_pass'] for s in subject_summaries) if subject_summaries else False,
                'calculation_mode': 'weighted' if use_weighted and exams.count() > 1 else 'simple',
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
        
        # Filter by subject
        subject_id = self.request.query_params.get('subject')
        if subject_id:
            qs = qs.filter(subject_id=subject_id)
        
        # Filter by exam type
        exam_type_id = self.request.query_params.get('exam_type')
        if exam_type_id:
            qs = qs.filter(exam_type_id=exam_type_id)
        
        # Filter by question type
        question_type = self.request.query_params.get('question_type')
        if question_type:
            qs = qs.filter(question_type=question_type)
        
        # Filter by difficulty
        difficulty = self.request.query_params.get('difficulty')
        if difficulty:
            qs = qs.filter(difficulty_level=difficulty)
        
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
        
        return qs.select_related('subject', 'exam_type', 'created_by')

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        serializer.save(school_id=school_id, created_by=self.request.user)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()
    
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
            return Response({
                'message': f'Generated {len(created_questions)} questions',
                'questions': serializer.data,
            }, status=status.HTTP_201_CREATED)
            
        except requests.RequestException as e:
            return Response(
                {'error': f'API error: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except json.JSONDecodeError as e:
            return Response(
                {'error': f'Invalid JSON from AI: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
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
        
        topic_ids = lesson.planned_topics.values_list('id', flat=True)
        qs = self.get_queryset().filter(tested_topics__id__in=topic_ids).distinct()
        
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


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
        serializer.save(school_id=school_id, generated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

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
        Returns: topics count, covered topics, lesson plans, etc.
        """
        exam_paper = self.get_object()
        
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
                        paper_questions__exam_paper=exam_paper
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
            'topic_count': exam_paper.covered_topics.count(),
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
            PaperQuestion.objects.create(
                exam_paper=exam_paper,
                question=q,
                question_order=idx + 1,
                marks_override=q.marks,
            )
        
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
        """Upload paper image and trigger OCR processing."""
        from core.storage import SupabaseStorageService
        from .tasks import process_paper_upload_ocr
        
        serializer = PaperUploadCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        image_file = serializer.validated_data['image']
        school_id = _resolve_school_id(request)
        
        if not school_id:
            return Response(
                {'detail': 'School ID is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
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
                status=PaperUpload.Status.PENDING
            )
            
            # Trigger async OCR processing
            process_paper_upload_ocr.delay(upload.id)
            
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
        """Confirm extracted questions and create ExamPaper."""
        upload = self.get_object()
        
        if upload.status != PaperUpload.Status.EXTRACTED:
            return Response(
                {'detail': 'Upload must be in EXTRACTED status'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get confirmed data from request
        confirmed_json = request.data.get('confirmed_data')
        paper_metadata = request.data.get('paper_metadata', {})
        
        if not confirmed_json:
            return Response(
                {'detail': 'confirmed_data is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            school_id = _resolve_school_id(request)
            
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
                PaperQuestion.objects.create(
                    exam_paper=exam_paper,
                    question=question,
                    question_order=idx,
                    marks_override=q_data.get('marks')
                )
            
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


class PaperFeedbackViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
    """ViewSet for PaperFeedback (read-only for analytics)."""
    required_module = 'examinations'
    queryset = PaperFeedback.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
    serializer_class = PaperFeedbackSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.select_related('paper_upload', 'confirmed_by').order_by('-created_at')
