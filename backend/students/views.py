"""
Student and Class views.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count, Q

from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db.models import Sum, Avg

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
    IsStudent, IsStudentOrAdmin, get_effective_role, ADMIN_ROLES, ROLE_HIERARCHY,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from .models import Class, Student, StudentDocument, StudentProfile, StudentInvite
from .serializers import (
    ClassSerializer,
    ClassCreateSerializer,
    StudentSerializer,
    StudentCreateSerializer,
    StudentBulkCreateSerializer,
    StudentDocumentSerializer,
)

User = get_user_model()


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


class ClassViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'students'
    queryset = Class.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ClassCreateSerializer
        return ClassSerializer

    def get_queryset(self):
        queryset = Class.objects.select_related('school')

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

        grade_level = self.request.query_params.get('grade_level')
        if grade_level:
            queryset = queryset.filter(grade_level=grade_level)

        section = self.request.query_params.get('section')
        if section:
            queryset = queryset.filter(section=section)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset.order_by('grade_level', 'section', 'name')

    def perform_create(self, serializer):
        school_id = self.request.data.get('school')
        if not school_id:
            school_id = ensure_tenant_school_id(self.request) or self.request.user.school_id
        if school_id:
            serializer.save(school_id=school_id)
        else:
            serializer.save()


from django.db import models as db_models


class StudentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'students'
    queryset = Student.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return StudentCreateSerializer
        if self.action == 'bulk_create':
            return StudentBulkCreateSerializer
        return StudentSerializer

    def get_queryset(self):
        queryset = Student.objects.select_related(
            'school', 'class_obj',
        ).prefetch_related('user_profile__user')

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

    @action(detail=True, methods=['post'], url_path='create-user-account')
    def create_user_account(self, request, pk=None):
        """Create a User account + StudentProfile + Membership for an existing student."""
        student = self.get_object()

        # Check if student already has a user account
        if hasattr(student, 'user_profile') and student.user_profile is not None:
            return Response(
                {'error': 'This student already has a linked user account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        username = request.data.get('username')
        email = request.data.get('email', '')
        password = request.data.get('password')
        confirm_password = request.data.get('confirm_password')

        if not username or not password:
            return Response(
                {'error': 'username and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if password != confirm_password:
            return Response(
                {'error': "Passwords don't match."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(password) < 8:
            return Response(
                {'error': 'Password must be at least 8 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(username=username).exists():
            return Response(
                {'error': 'This username is already taken.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create user
        user = User(
            username=username,
            email=email,
            first_name=student.name.split()[0] if student.name else '',
            last_name=' '.join(student.name.split()[1:]) if student.name and len(student.name.split()) > 1 else '',
            role='STAFF',  # base role; school-level role is STUDENT via membership
            school_id=student.school_id,
        )
        user.set_password(password)
        user.save()

        # Create StudentProfile link
        StudentProfile.objects.create(
            user=user,
            student=student,
            school_id=student.school_id,
        )

        # Create school membership with STUDENT role
        from schools.models import UserSchoolMembership
        UserSchoolMembership.objects.get_or_create(
            user=user,
            school_id=student.school_id,
            defaults={'role': 'STUDENT', 'is_default': True, 'is_active': True},
        )

        return Response({
            'message': 'User account created successfully.',
            'user_id': user.id,
            'username': user.username,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='bulk-create-accounts')
    def bulk_create_accounts(self, request):
        """Bulk create user accounts for multiple existing students."""
        import re

        student_ids = request.data.get('student_ids', [])
        default_password = request.data.get('default_password', '')

        if not student_ids:
            return Response({'error': 'student_ids is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not default_password or len(default_password) < 8:
            return Response({'error': 'default_password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'No school associated.'}, status=status.HTTP_400_BAD_REQUEST)

        students = Student.objects.filter(
            id__in=student_ids, school_id=school_id,
        ).prefetch_related('user_profile')

        created = []
        skipped = []
        errors = []

        for student in students:
            if hasattr(student, 'user_profile') and student.user_profile is not None:
                skipped.append({'student_id': student.id, 'name': student.name, 'reason': 'Already has account'})
                continue

            # Auto-generate username from name
            base = re.sub(r'[^a-z0-9_]', '', student.name.lower().replace(' ', '_'))
            if not base:
                base = 'student'
            username = base
            if User.objects.filter(username=username).exists():
                username = f'{base}_{student.roll_number}' if student.roll_number else f'{base}_{student.id}'
                username = re.sub(r'[^a-z0-9_]', '', username.lower())
            if User.objects.filter(username=username).exists():
                username = f'{base}_{student.roll_number}_{school_id}'
                username = re.sub(r'[^a-z0-9_]', '', username.lower())
            if User.objects.filter(username=username).exists():
                errors.append({'student_id': student.id, 'name': student.name, 'error': 'Could not generate unique username'})
                continue

            try:
                name_parts = student.name.split() if student.name else ['']
                first_name = name_parts[0]
                last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

                user = User(
                    username=username,
                    email=student.guardian_email or '',
                    first_name=first_name,
                    last_name=last_name,
                    role='STAFF',  # base role; school-level role is STUDENT via membership
                    school_id=school_id,
                )
                user.set_password(default_password)
                user.save()

                StudentProfile.objects.create(
                    user=user,
                    student=student,
                    school_id=school_id,
                )

                from schools.models import UserSchoolMembership
                UserSchoolMembership.objects.get_or_create(
                    user=user,
                    school_id=school_id,
                    defaults={'role': 'STUDENT', 'is_default': True, 'is_active': True},
                )

                created.append({
                    'student_id': student.id,
                    'username': username,
                    'student_name': student.name,
                })
            except Exception as e:
                errors.append({'student_id': student.id, 'name': student.name, 'error': str(e)})

        return Response({
            'created_count': len(created),
            'skipped_count': len(skipped),
            'error_count': len(errors),
            'created': created,
            'skipped': skipped,
            'errors': errors,
        })

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

    @action(detail=True, methods=['get'])
    def profile_summary(self, request, pk=None):
        """Aggregated student profile stats: attendance, fees, academics."""
        student = self.get_object()
        from django.db.models import Sum, Avg
        from decimal import Decimal

        # Attendance stats
        from attendance.models import AttendanceRecord
        attendance_qs = AttendanceRecord.objects.filter(student=student)
        total_days = attendance_qs.count()
        total_present = attendance_qs.filter(status='PRESENT').count()
        total_absent = attendance_qs.filter(status='ABSENT').count()
        attendance_rate = round(total_present / total_days * 100, 1) if total_days > 0 else 0.0

        # Fee stats
        from finance.models import FeePayment
        fee_agg = FeePayment.objects.filter(student=student).aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )
        fee_total_due = fee_agg['total_due'] or Decimal('0')
        fee_total_paid = fee_agg['total_paid'] or Decimal('0')

        # Exam average
        exam_average = None
        try:
            from examinations.models import StudentMark
            avg = StudentMark.objects.filter(student=student).aggregate(
                avg_score=Avg('marks_obtained')
            )
            exam_average = round(avg['avg_score'], 1) if avg['avg_score'] else None
        except Exception:
            pass

        # Enrollment status
        enrollment_status = None
        try:
            from academic_sessions.models import StudentEnrollment
            latest = StudentEnrollment.objects.filter(
                student=student
            ).order_by('-academic_year__start_date').first()
            if latest:
                enrollment_status = latest.status
        except Exception:
            pass

        return Response({
            'student': StudentSerializer(student).data,
            'attendance_rate': attendance_rate,
            'total_present': total_present,
            'total_absent': total_absent,
            'total_days': total_days,
            'fee_total_due': str(fee_total_due),
            'fee_total_paid': str(fee_total_paid),
            'fee_outstanding': str(fee_total_due - fee_total_paid),
            'exam_average': exam_average,
            'enrollment_status': enrollment_status,
        })

    @action(detail=True, methods=['get'])
    def attendance_history(self, request, pk=None):
        """Monthly attendance breakdown for a student."""
        student = self.get_object()
        from attendance.models import AttendanceRecord
        from django.db.models.functions import TruncMonth

        records = AttendanceRecord.objects.filter(
            student=student
        ).annotate(
            month=TruncMonth('date')
        ).values('month').annotate(
            present=Count('id', filter=Q(status='PRESENT')),
            absent=Count('id', filter=Q(status='ABSENT')),
            total=Count('id'),
        ).order_by('-month')

        return Response(list(records))

    @action(detail=True, methods=['get'])
    def fee_ledger(self, request, pk=None):
        """All fee payments for a student."""
        student = self.get_object()
        from finance.models import FeePayment
        from finance.serializers import FeePaymentSerializer

        payments = FeePayment.objects.filter(
            student=student
        ).order_by('-year', '-month')

        return Response(FeePaymentSerializer(payments, many=True).data)

    @action(detail=True, methods=['get'])
    def exam_results(self, request, pk=None):
        """All exam marks grouped by exam."""
        student = self.get_object()
        try:
            from examinations.models import StudentMark
            marks = StudentMark.objects.filter(
                student=student
            ).select_related(
                'exam_subject', 'exam_subject__exam', 'exam_subject__subject'
            ).order_by('-exam_subject__exam__date', 'exam_subject__subject__name')

            result = {}
            for mark in marks:
                exam_name = mark.exam_subject.exam.name
                if exam_name not in result:
                    result[exam_name] = {
                        'exam_name': exam_name,
                        'exam_date': str(mark.exam_subject.exam.date) if hasattr(mark.exam_subject.exam, 'date') else None,
                        'subjects': [],
                    }
                result[exam_name]['subjects'].append({
                    'subject': mark.exam_subject.subject.name,
                    'marks_obtained': float(mark.marks_obtained) if mark.marks_obtained else None,
                    'total_marks': float(mark.exam_subject.total_marks) if mark.exam_subject.total_marks else None,
                    'grade': mark.grade if hasattr(mark, 'grade') else None,
                })

            return Response(list(result.values()))
        except Exception:
            return Response([])

    @action(detail=True, methods=['get'])
    def enrollment_history(self, request, pk=None):
        """Enrollment records across academic years."""
        student = self.get_object()
        try:
            from academic_sessions.models import StudentEnrollment
            enrollments = StudentEnrollment.objects.filter(
                student=student
            ).select_related('academic_year', 'class_enrolled').order_by('-academic_year__start_date')

            result = []
            for e in enrollments:
                result.append({
                    'academic_year': str(e.academic_year),
                    'class_name': e.class_enrolled.name if e.class_enrolled else None,
                    'roll_number': e.roll_number,
                    'status': e.status,
                })
            return Response(result)
        except Exception:
            return Response([])

    @action(detail=True, methods=['get', 'post'], url_path='documents')
    def documents(self, request, pk=None):
        """List or upload student documents."""
        student = self.get_object()

        if request.method == 'GET':
            docs = StudentDocument.objects.filter(student=student)
            return Response(StudentDocumentSerializer(docs, many=True).data)

        # POST
        serializer = StudentDocumentSerializer(data={
            **request.data,
            'school': student.school_id,
            'student': student.id,
        })
        serializer.is_valid(raise_exception=True)
        serializer.save(uploaded_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path='documents/(?P<doc_id>[0-9]+)')
    def delete_document(self, request, pk=None, doc_id=None):
        """Delete a student document."""
        student = self.get_object()
        try:
            doc = StudentDocument.objects.get(id=doc_id, student=student)
            doc.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except StudentDocument.DoesNotExist:
            return Response({'error': 'Document not found'}, status=404)

    @action(detail=True, methods=['get'], url_path='ai-profile')
    def ai_profile(self, request, pk=None):
        """AI-generated 360 student risk profile."""
        student = self.get_object()
        from .ai_service import Student360Service
        service = Student360Service(student.school_id, student.id)
        profile = service.generate_profile()
        return Response(profile)


# ── Student Portal Views ────────────────────────────────────────


def _get_student_for_request(request):
    """Get the Student record linked to the authenticated student user."""
    try:
        return request.user.student_profile.student
    except (StudentProfile.DoesNotExist, AttributeError):
        return None


class StudentRegistrationView(APIView):
    """Register a student account using an invite code."""
    permission_classes = []

    def post(self, request):
        invite_code = request.data.get('invite_code', '').strip()
        email = request.data.get('email', '').strip()
        password = request.data.get('password', '')
        full_name = request.data.get('full_name', '').strip()

        if not all([invite_code, email, password]):
            return Response(
                {'error': 'invite_code, email, and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            invite = StudentInvite.objects.select_related('student', 'school').get(
                invite_code=invite_code,
            )
        except StudentInvite.DoesNotExist:
            return Response({'error': 'Invalid invite code.'}, status=status.HTTP_400_BAD_REQUEST)

        if not invite.is_valid:
            return Response({'error': 'Invite code has expired or already been used.'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(email=email).exists():
            return Response({'error': 'A user with this email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        if hasattr(invite.student, 'user_profile'):
            return Response({'error': 'This student already has a portal account.'}, status=status.HTTP_400_BAD_REQUEST)

        # Create user + profile + membership
        user = User.objects.create_user(
            email=email,
            password=password,
            first_name=full_name.split()[0] if full_name else '',
            last_name=' '.join(full_name.split()[1:]) if full_name and len(full_name.split()) > 1 else '',
        )

        StudentProfile.objects.create(
            user=user,
            student=invite.student,
            school=invite.school,
        )

        from schools.models import UserSchoolMembership
        UserSchoolMembership.objects.create(
            user=user,
            school=invite.school,
            role=UserSchoolMembership.Role.STUDENT,
            is_default=True,
        )

        invite.is_used = True
        invite.save(update_fields=['is_used'])

        return Response({
            'message': 'Student account created successfully.',
            'student_name': invite.student.name,
            'school_name': invite.school.name,
        }, status=status.HTTP_201_CREATED)


class StudentDashboardView(APIView):
    """Dashboard data for a logged-in student."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from attendance.models import AttendanceRecord
        from finance.models import FeePayment

        # Attendance summary
        att_qs = AttendanceRecord.objects.filter(student=student)
        total_days = att_qs.count()
        present = att_qs.filter(status='PRESENT').count()
        absent = att_qs.filter(status='ABSENT').count()

        # Fee summary
        fee_agg = FeePayment.objects.filter(student=student).aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )

        # Upcoming assignments
        upcoming_assignments = []
        try:
            from lms.models import Assignment
            assignments = Assignment.objects.filter(
                class_obj=student.class_obj,
                school=student.school,
                status='PUBLISHED',
                due_date__gte=timezone.now(),
            ).select_related('subject').order_by('due_date')[:5]
            upcoming_assignments = [
                {
                    'id': a.id,
                    'title': a.title,
                    'subject': a.subject.name,
                    'due_date': a.due_date.isoformat(),
                    'type': a.assignment_type,
                }
                for a in assignments
            ]
        except Exception:
            pass

        # Today's timetable
        today_timetable = []
        try:
            from academics.models import TimetableEntry
            day_map = {0: 'MON', 1: 'TUE', 2: 'WED', 3: 'THU', 4: 'FRI', 5: 'SAT', 6: 'SUN'}
            today = day_map.get(timezone.now().weekday(), 'MON')
            entries = TimetableEntry.objects.filter(
                class_obj=student.class_obj,
                school=student.school,
                day=today,
            ).select_related('slot', 'subject', 'teacher').order_by('slot__order')
            today_timetable = [
                {
                    'slot': e.slot.name,
                    'start_time': str(e.slot.start_time),
                    'end_time': str(e.slot.end_time),
                    'subject': e.subject.name if e.subject else None,
                    'teacher': e.teacher.user.get_full_name() if e.teacher else None,
                    'room': e.room,
                }
                for e in entries
            ]
        except Exception:
            pass

        return Response({
            'student': StudentSerializer(student).data,
            'attendance': {
                'total_days': total_days,
                'present': present,
                'absent': absent,
                'rate': round(present / total_days * 100, 1) if total_days > 0 else 0,
            },
            'fees': {
                'total_due': str(fee_agg['total_due'] or 0),
                'total_paid': str(fee_agg['total_paid'] or 0),
                'outstanding': str((fee_agg['total_due'] or 0) - (fee_agg['total_paid'] or 0)),
            },
            'upcoming_assignments': upcoming_assignments,
            'today_timetable': today_timetable,
        })


class StudentAttendanceView(APIView):
    """Student's own attendance records."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from attendance.models import AttendanceRecord
        qs = AttendanceRecord.objects.filter(student=student).order_by('-date')

        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            qs = qs.filter(date__month=int(month), date__year=int(year))

        records = [
            {
                'date': str(r.date),
                'status': r.status,
                'source': r.source if hasattr(r, 'source') else None,
            }
            for r in qs[:200]
        ]
        total = qs.count()
        present = qs.filter(status='PRESENT').count()

        return Response({
            'records': records,
            'summary': {
                'total_days': total,
                'present': present,
                'absent': qs.filter(status='ABSENT').count(),
                'late': qs.filter(status='LATE').count(),
                'rate': round(present / total * 100, 1) if total > 0 else 0,
            },
        })


class StudentFeesView(APIView):
    """Student's own fee records."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from finance.models import FeePayment
        from finance.serializers import FeePaymentSerializer
        payments = FeePayment.objects.filter(student=student).order_by('-year', '-month')
        return Response(FeePaymentSerializer(payments, many=True).data)


class StudentTimetableView(APIView):
    """Student's class timetable."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from academics.models import TimetableEntry, TimetableSlot
        slots = TimetableSlot.objects.filter(school=student.school).order_by('order')
        entries = TimetableEntry.objects.filter(
            class_obj=student.class_obj,
            school=student.school,
        ).select_related('slot', 'subject', 'teacher')

        slot_data = [
            {'id': s.id, 'name': s.name, 'start_time': str(s.start_time), 'end_time': str(s.end_time), 'slot_type': s.slot_type, 'order': s.order}
            for s in slots
        ]
        entry_data = [
            {
                'day': e.day,
                'slot_id': e.slot_id,
                'subject': e.subject.name if e.subject else None,
                'teacher': e.teacher.user.get_full_name() if e.teacher else None,
                'room': e.room,
            }
            for e in entries
        ]

        return Response({'slots': slot_data, 'entries': entry_data})


class StudentResultsView(APIView):
    """Student's own exam results."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        try:
            from examinations.models import StudentMark
            marks = StudentMark.objects.filter(
                student=student,
            ).select_related(
                'exam_subject', 'exam_subject__exam', 'exam_subject__subject',
            ).order_by('-exam_subject__exam__start_date', 'exam_subject__subject__name')

            result = {}
            for mark in marks:
                exam = mark.exam_subject.exam
                exam_key = str(exam.id)
                if exam_key not in result:
                    result[exam_key] = {
                        'exam_name': exam.name,
                        'exam_type': exam.exam_type.name if exam.exam_type else None,
                        'subjects': [],
                    }
                result[exam_key]['subjects'].append({
                    'subject': mark.exam_subject.subject.name,
                    'marks_obtained': float(mark.marks_obtained) if mark.marks_obtained else None,
                    'total_marks': float(mark.exam_subject.total_marks) if mark.exam_subject.total_marks else None,
                    'is_absent': mark.is_absent,
                })

            return Response(list(result.values()))
        except Exception:
            return Response([])


class StudentAssignmentsView(APIView):
    """Student's assignments and submission status."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        try:
            from lms.models import Assignment, AssignmentSubmission
            assignments = Assignment.objects.filter(
                class_obj=student.class_obj,
                school=student.school,
                status__in=['PUBLISHED', 'CLOSED'],
                is_active=True,
            ).select_related('subject', 'teacher').order_by('-due_date')

            data = []
            for a in assignments:
                submission = AssignmentSubmission.objects.filter(
                    assignment=a, student=student,
                ).first()
                data.append({
                    'id': a.id,
                    'title': a.title,
                    'description': a.description,
                    'subject': a.subject.name,
                    'teacher': a.teacher.user.get_full_name() if a.teacher else None,
                    'assignment_type': a.assignment_type,
                    'due_date': a.due_date.isoformat(),
                    'total_marks': float(a.total_marks) if a.total_marks else None,
                    'status': a.status,
                    'submission': {
                        'id': submission.id,
                        'status': submission.status,
                        'submitted_at': submission.submitted_at.isoformat(),
                        'marks_obtained': float(submission.marks_obtained) if submission.marks_obtained else None,
                        'feedback': submission.feedback,
                    } if submission else None,
                })
            return Response(data)
        except Exception:
            return Response([])

    def post(self, request):
        """Submit an assignment."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        assignment_id = request.data.get('assignment_id')
        if not assignment_id:
            return Response({'error': 'assignment_id is required.'}, status=400)

        try:
            from lms.models import Assignment, AssignmentSubmission
            assignment = Assignment.objects.get(
                id=assignment_id,
                class_obj=student.class_obj,
                school=student.school,
                status='PUBLISHED',
            )
        except Exception:
            return Response({'error': 'Assignment not found or not available.'}, status=404)

        if AssignmentSubmission.objects.filter(assignment=assignment, student=student).exists():
            return Response({'error': 'You have already submitted this assignment.'}, status=400)

        sub_status = 'SUBMITTED'
        if assignment.due_date and timezone.now() > assignment.due_date:
            sub_status = 'LATE'

        submission = AssignmentSubmission.objects.create(
            assignment=assignment,
            student=student,
            school=student.school,
            submission_text=request.data.get('submission_text', ''),
            file_url=request.data.get('file_url', ''),
            file_name=request.data.get('file_name', ''),
            status=sub_status,
        )

        return Response({
            'id': submission.id,
            'status': submission.status,
            'submitted_at': submission.submitted_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class AdminStudentInviteView(APIView):
    """Admin endpoint to generate student portal invite codes."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def post(self, request):
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required.'}, status=400)

        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({'error': 'Student not found.'}, status=404)

        if hasattr(student, 'user_profile'):
            return Response({'error': 'This student already has a portal account.'}, status=400)

        invite = StudentInvite.objects.create(
            school=student.school,
            student=student,
            created_by=request.user,
        )

        return Response({
            'invite_code': invite.invite_code,
            'student_name': student.name,
            'expires_at': invite.expires_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class StudyHelperView(APIView):
    """AI Study Helper chat for students."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        """Get chat history (last 50 messages)."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        from .models import StudyHelperMessage
        messages = StudyHelperMessage.objects.filter(student=student).order_by('-created_at')[:50]
        data = [
            {
                'id': m.id,
                'role': m.role,
                'content': m.content,
                'created_at': m.created_at,
            }
            for m in reversed(messages)
        ]
        return Response(data)

    def post(self, request):
        """Send a message and get AI response."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        message = request.data.get('message', '').strip()
        if not message:
            return Response({'error': 'Message is required.'}, status=400)
        if len(message) > 2000:
            return Response({'error': 'Message too long (max 2000 characters).'}, status=400)

        from .study_helper_service import StudyHelperService
        service = StudyHelperService(student, student.school)

        if not service.check_rate_limit():
            return Response(
                {'error': 'Daily limit reached (30 messages/day). Try again tomorrow.'},
                status=429,
            )

        is_safe, reason = service.check_content_safety(message)
        if not is_safe:
            return Response({'error': reason}, status=400)

        try:
            response_text = service.chat(message)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Study helper error: {e}")
            response_text = "I'm sorry, I encountered an error. Please try again."

        return Response({'response': response_text})

    def delete(self, request):
        """Clear chat history."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        from .models import StudyHelperMessage
        count, _ = StudyHelperMessage.objects.filter(student=student).delete()
        return Response({'deleted': count})
