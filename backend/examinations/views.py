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

from .models import ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale
from .serializers import (
    ExamTypeSerializer, ExamTypeCreateSerializer,
    ExamSerializer, ExamCreateSerializer,
    ExamSubjectSerializer, ExamSubjectCreateSerializer,
    StudentMarkSerializer, StudentMarkCreateSerializer,
    StudentMarkBulkEntrySerializer,
    GradeScaleSerializer, GradeScaleCreateSerializer,
    ExamGroupSerializer, ExamGroupCreateSerializer,
    ExamGroupWizardCreateSerializer, DateSheetUpdateSerializer,
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
        qs = super().get_queryset().select_related(
            'school', 'academic_year', 'term', 'exam_type',
        ).annotate(
            classes_count=Count('exams', filter=Q(exams__is_active=True)),
        )
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        term = self.request.query_params.get('term')
        if term:
            qs = qs.filter(term_id=term)
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
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

        # Check for conflicts
        conflicts = []
        for cls in valid_classes:
            existing = Exam.objects.filter(
                school_id=school_id,
                exam_type_id=data['exam_type'],
                class_obj=cls,
                term_id=data.get('term'),
            ).first()
            if existing:
                conflicts.append({
                    'class_id': cls.id,
                    'class_name': cls.name,
                    'existing_exam': existing.name,
                })
        if conflicts:
            return Response({
                'detail': 'Some classes already have an exam of this type for this term.',
                'conflicts': conflicts,
            }, status=status.HTTP_409_CONFLICT)

        date_sheet = data.get('date_sheet', {})
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
                    subject_date = date_sheet.get(str(cs.subject_id))
                    all_exam_subjects.append(ExamSubject(
                        school_id=school_id,
                        exam=exam,
                        subject=cs.subject,
                        total_marks=default_total,
                        passing_marks=default_passing,
                        exam_date=subject_date,
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
            exam_date = entry.get('exam_date')
            if es_id:
                count = ExamSubject.objects.filter(
                    id=es_id, exam__exam_group=group, school_id=school_id,
                ).update(exam_date=exam_date)
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

        ws.merge_cells('A1:E1')
        ws['A1'] = f'Date Sheet - {group.name}'
        ws['A1'].font = Font(bold=True, size=14)

        ws.merge_cells('A2:E2')
        period = ''
        if group.start_date and group.end_date:
            period = f' | {group.start_date} to {group.end_date}'
        ws['A2'] = f'Exam Type: {group.exam_type.name}{period}'
        ws['A2'].font = Font(size=10, color='555555')

        headers = ['#', 'Date', 'Subject', 'Code', 'Classes']
        header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
        header_font = Font(bold=True, color='FFFFFF', size=10)
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin'),
        )

        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')
            cell.border = thin_border

        by_subject = {}
        for es in exam_subjects:
            sid = es.subject_id
            if sid not in by_subject:
                by_subject[sid] = {
                    'subject_name': es.subject.name,
                    'subject_code': es.subject.code,
                    'exam_date': es.exam_date,
                    'classes': [],
                }
            by_subject[sid]['classes'].append(es.exam.class_obj.name)

        sorted_subjects = sorted(
            by_subject.values(),
            key=lambda x: (str(x['exam_date'] or '9999-99-99'), x['subject_name']),
        )

        for row_idx, subj in enumerate(sorted_subjects, 5):
            ws.cell(row=row_idx, column=1, value=row_idx - 4).border = thin_border
            ws.cell(row=row_idx, column=2, value=str(subj['exam_date'] or 'TBD')).border = thin_border
            ws.cell(row=row_idx, column=3, value=subj['subject_name']).border = thin_border
            ws.cell(row=row_idx, column=4, value=subj['subject_code']).border = thin_border
            ws.cell(row=row_idx, column=5, value=', '.join(subj['classes'])).border = thin_border

        ws.column_dimensions['A'].width = 5
        ws.column_dimensions['B'].width = 14
        ws.column_dimensions['C'].width = 25
        ws.column_dimensions['D'].width = 10
        ws.column_dimensions['E'].width = 40

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

        for entry in marks_data:
            student_id = entry.get('student_id')
            marks_obtained = entry.get('marks_obtained')
            is_absent = entry.get('is_absent', False)
            remarks = entry.get('remarks', '')

            if marks_obtained is not None:
                marks_obtained = Decimal(str(marks_obtained))

            try:
                mark, was_created = StudentMark.objects.update_or_create(
                    school_id=school_id,
                    exam_subject=exam_subject,
                    student_id=student_id,
                    defaults={
                        'marks_obtained': None if is_absent else marks_obtained,
                        'is_absent': is_absent,
                        'remarks': remarks,
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

        if not student_id:
            return Response({'detail': 'student_id required.'}, status=400)

        school_id = _resolve_school_id(request)

        from students.models import Student
        try:
            student = Student.objects.select_related('class_obj', 'school').get(
                pk=student_id, school_id=school_id,
            )
        except Student.DoesNotExist:
            return Response({'detail': 'Student not found.'}, status=404)

        # Get exams for this student's class
        exam_filter = {
            'school_id': school_id,
            'class_obj': student.class_obj,
            'is_active': True,
            'status': Exam.Status.PUBLISHED,
        }
        if academic_year_id:
            exam_filter['academic_year_id'] = academic_year_id
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

        # Calculate overall totals using prefetched data
        grand_total_obtained = Decimal('0')
        grand_total_possible = Decimal('0')
        for es in all_exam_subjects:
            mark = marks_lookup.get(es.id)
            if mark and mark.marks_obtained is not None and not mark.is_absent:
                grand_total_obtained += mark.marks_obtained
            grand_total_possible += es.total_marks

        overall_pct = float(grand_total_obtained / grand_total_possible * 100) if grand_total_possible > 0 else 0
        overall_grade = '-'
        for gs in grade_scales:
            if float(gs.min_percentage) <= overall_pct <= float(gs.max_percentage):
                overall_grade = gs.grade_label
                break

        return Response({
            'student': {
                'id': student.id,
                'name': student.name,
                'roll_number': student.roll_number,
                'class_name': student.class_obj.name,
                'school_name': student.school.name,
            },
            'subjects': all_subjects,
            'exams': exam_data,
            'summary': {
                'total_obtained': float(grand_total_obtained),
                'total_possible': float(grand_total_possible),
                'percentage': round(overall_pct, 2),
                'grade': overall_grade,
            },
        })
