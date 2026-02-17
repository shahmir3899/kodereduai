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

from .models import ExamType, Exam, ExamSubject, StudentMark, GradeScale
from .serializers import (
    ExamTypeSerializer, ExamTypeCreateSerializer,
    ExamSerializer, ExamCreateSerializer,
    ExamSubjectSerializer, ExamSubjectCreateSerializer,
    StudentMarkSerializer, StudentMarkCreateSerializer,
    StudentMarkBulkEntrySerializer,
    GradeScaleSerializer, GradeScaleCreateSerializer,
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
            'school', 'academic_year', 'term', 'exam_type', 'class_obj',
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
        instance.is_active = False
        instance.save()

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        exam = self.get_object()
        exam.status = Exam.Status.PUBLISHED
        exam.save(update_fields=['status'])
        return Response(ExamSerializer(exam).data)

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
        instance.is_active = False
        instance.save()


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

        # Get students from the exam's class
        from students.models import Student
        students = Student.objects.filter(
            school_id=school_id,
            student_class=exam_subject.exam.class_obj,
            is_active=True,
        ).order_by('roll_number', 'name')

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
