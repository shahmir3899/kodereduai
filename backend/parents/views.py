"""
Parent module views for registration, child management, leave requests,
messaging, and admin-facing parent/child administration.
"""

import uuid
from decimal import Decimal

from django.db import models as db_models
from django.db.models import Sum, Count, Q, Avg
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.generics import ListAPIView, CreateAPIView
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny, IsAuthenticated

from core.permissions import (
    IsParent, IsParentOrAdmin, IsSchoolAdmin, HasSchoolAccess,
    ModuleAccessMixin, get_effective_role, ADMIN_ROLES,
)
from core.mixins import ensure_tenant_school_id, ensure_tenant_schools
from students.models import Student
from .models import (
    ParentProfile,
    ParentChild,
    ParentInvite,
    ParentLeaveRequest,
    ParentMessage,
)
from .serializers import (
    ParentProfileSerializer,
    ParentRegistrationSerializer,
    ParentChildSerializer,
    ParentInviteSerializer,
    ParentLeaveRequestSerializer,
    ParentLeaveReviewSerializer,
    ParentMessageSerializer,
    ChildOverviewSerializer,
)


# ── Helpers ──────────────────────────────────────────────────

def get_parent_profile(request):
    """Return the ParentProfile for the authenticated user, or None."""
    try:
        return request.user.parent_profile
    except ParentProfile.DoesNotExist:
        return None


def get_parent_children_ids(request):
    """
    Return a set of student IDs linked to the requesting parent.
    Used for security checks -- parents must only access their own children.
    """
    profile = get_parent_profile(request)
    if not profile:
        return set()
    return set(
        ParentChild.objects.filter(parent=profile).values_list('student_id', flat=True)
    )


def _resolve_school_id(request):
    """Resolve school_id from header, params, or user."""
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


def _verify_child_access(request, student_id):
    """
    Verify the requesting parent has access to the given student.
    Admins bypass this check.
    """
    role = get_effective_role(request)
    if role in ADMIN_ROLES:
        return True
    return student_id in get_parent_children_ids(request)


# =============================================================================
# Parent-facing views
# =============================================================================


class ParentRegistrationView(APIView):
    """
    POST register/
    Public endpoint -- register a new parent account using an invite code.
    Creates User + ParentProfile + ParentChild + UserSchoolMembership.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ParentRegistrationSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        return Response(result, status=status.HTTP_201_CREATED)


class MyChildrenView(APIView):
    """
    GET my-children/
    List all children linked to the requesting parent.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request):
        profile = get_parent_profile(request)
        if not profile:
            return Response(
                {'error': 'Parent profile not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        links = ParentChild.objects.filter(
            parent=profile,
        ).select_related('student', 'student__class_obj', 'school')

        school_id = _resolve_school_id(request)
        if school_id:
            links = links.filter(school_id=school_id)

        serializer = ParentChildSerializer(links, many=True)
        return Response(serializer.data)


class ChildOverviewView(APIView):
    """
    GET children/<int:student_id>/overview/
    Aggregated child dashboard: attendance summary, fee status, latest exam.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            student = Student.objects.select_related('class_obj', 'school').get(id=student_id)
        except Student.DoesNotExist:
            return Response(
                {'error': 'Student not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Attendance summary
        from attendance.models import AttendanceRecord
        att_qs = AttendanceRecord.objects.filter(student=student)
        total_days = att_qs.count()
        total_present = att_qs.filter(status='PRESENT').count()
        total_absent = att_qs.filter(status='ABSENT').count()
        attendance_rate = round(total_present / total_days * 100, 1) if total_days > 0 else 0.0
        attendance_summary = {
            'total_days': total_days,
            'present': total_present,
            'absent': total_absent,
            'attendance_rate': attendance_rate,
        }

        # Fee summary
        from finance.models import FeePayment
        fee_agg = FeePayment.objects.filter(student=student).aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )
        fee_total_due = fee_agg['total_due'] or Decimal('0')
        fee_total_paid = fee_agg['total_paid'] or Decimal('0')
        fee_summary = {
            'total_due': str(fee_total_due),
            'total_paid': str(fee_total_paid),
            'outstanding': str(fee_total_due - fee_total_paid),
        }

        # Latest exam
        latest_exam = None
        try:
            from examinations.models import StudentMark
            latest_mark = StudentMark.objects.filter(
                student=student,
            ).select_related(
                'exam_subject', 'exam_subject__exam', 'exam_subject__subject',
            ).order_by('-exam_subject__exam__date').first()

            if latest_mark:
                latest_exam = {
                    'exam_name': latest_mark.exam_subject.exam.name,
                    'subject': latest_mark.exam_subject.subject.name,
                    'marks_obtained': float(latest_mark.marks_obtained) if latest_mark.marks_obtained else None,
                    'total_marks': float(latest_mark.exam_subject.total_marks) if latest_mark.exam_subject.total_marks else None,
                }
        except Exception:
            pass

        data = {
            'student_id': student.id,
            'student_name': student.name,
            'class_name': student.class_obj.name,
            'roll_number': student.roll_number,
            'school_name': student.school.name,
            'attendance_summary': attendance_summary,
            'fee_summary': fee_summary,
            'latest_exam': latest_exam,
        }

        serializer = ChildOverviewSerializer(data)
        return Response(serializer.data)


class ChildAttendanceView(APIView):
    """
    GET children/<int:student_id>/attendance/?month=&year=
    Attendance records for a child, filterable by month/year.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        from attendance.models import AttendanceRecord

        qs = AttendanceRecord.objects.filter(
            student_id=student_id,
        ).order_by('-date')

        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month:
            qs = qs.filter(date__month=int(month))
        if year:
            qs = qs.filter(date__year=int(year))

        records = qs.values('id', 'date', 'status', 'source', 'created_at')
        return Response(list(records))


class ChildFeesView(APIView):
    """
    GET children/<int:student_id>/fees/
    Fee payment records for a child.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        from finance.models import FeePayment
        from finance.serializers import FeePaymentSerializer

        payments = FeePayment.objects.filter(
            student_id=student_id,
        ).order_by('-year', '-month')

        return Response(FeePaymentSerializer(payments, many=True).data)


class ParentPayFeeView(APIView):
    """
    POST children/<int:student_id>/pay-fee/
    Parent initiates an online payment for a child's fee.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        """Return available gateways for this child's school."""
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({'error': 'Student not found.'}, status=status.HTTP_404_NOT_FOUND)

        from finance.models import PaymentGatewayConfig
        gateways = PaymentGatewayConfig.objects.filter(
            school=student.school, is_active=True,
        ).values('id', 'gateway', 'is_default', 'currency')
        return Response({'gateways': list(gateways)})

    def post(self, request, student_id):
        """Initiate payment via the gateway service."""
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        from finance.models import FeePayment, PaymentGatewayConfig, OnlinePayment
        from finance.payment_gateway_service import get_gateway, PaymentGatewayError

        fee_payment_id = request.data.get('fee_payment_id')
        gateway_type = request.data.get('gateway')
        return_url = request.data.get('return_url', '')

        if not fee_payment_id or not gateway_type:
            return Response(
                {'error': 'fee_payment_id and gateway are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fee_payment = FeePayment.objects.get(id=fee_payment_id, student_id=student_id)
        except FeePayment.DoesNotExist:
            return Response({'error': 'Fee payment not found.'}, status=status.HTTP_404_NOT_FOUND)

        outstanding = fee_payment.amount_due - fee_payment.amount_paid
        if outstanding <= 0:
            return Response({'error': 'This fee is already fully paid.'}, status=status.HTTP_400_BAD_REQUEST)

        gateway_config = PaymentGatewayConfig.objects.filter(
            school=fee_payment.school, gateway=gateway_type.upper(), is_active=True,
        ).first()
        if not gateway_config:
            return Response(
                {'error': f'Gateway {gateway_type} is not active for this school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        import uuid as _uuid
        order_id = f"ORD-{_uuid.uuid4().hex[:16].upper()}"

        try:
            gw = get_gateway(gateway_config)
            payment_data = gw.initiate_payment(
                order_id=order_id,
                amount=outstanding,
                description=f"Fee payment for {fee_payment.student.name} - {fee_payment.get_month_display()}/{fee_payment.year}",
                return_url=return_url,
            )
        except PaymentGatewayError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        online_payment = OnlinePayment.objects.create(
            school=fee_payment.school,
            fee_payment=fee_payment,
            student_id=student_id,
            gateway=gateway_type.upper(),
            gateway_order_id=order_id,
            amount=outstanding,
            currency=gateway_config.currency,
            status='INITIATED',
            initiated_by=request.user,
        )

        return Response({
            'order_id': order_id,
            'payment_id': online_payment.id,
            'amount': str(outstanding),
            'currency': gateway_config.currency,
            'redirect_url': payment_data.get('redirect_url'),
            'payload': payment_data.get('payload', {}),
            'method': payment_data.get('method', 'POST'),
        }, status=status.HTTP_201_CREATED)


class ChildTimetableView(APIView):
    """
    GET children/<int:student_id>/timetable/
    Timetable entries for a child's class.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            student = Student.objects.select_related('class_obj').get(id=student_id)
        except Student.DoesNotExist:
            return Response(
                {'error': 'Student not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        from academics.models import TimetableEntry

        entries = TimetableEntry.objects.filter(
            class_obj=student.class_obj,
        ).select_related(
            'slot', 'subject', 'teacher',
        ).order_by('day', 'slot__order')

        result = []
        for entry in entries:
            result.append({
                'id': entry.id,
                'day': entry.day,
                'day_display': entry.get_day_display(),
                'slot_name': entry.slot.name,
                'start_time': str(entry.slot.start_time),
                'end_time': str(entry.slot.end_time),
                'subject': entry.subject.name if entry.subject else None,
                'teacher': entry.teacher.full_name if entry.teacher else None,
                'room': entry.room,
            })

        return Response(result)


class ChildExamResultsView(APIView):
    """
    GET children/<int:student_id>/exam-results/
    Exam results for a child, grouped by exam.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            from examinations.models import StudentMark
            marks = StudentMark.objects.filter(
                student_id=student_id,
            ).select_related(
                'exam_subject', 'exam_subject__exam', 'exam_subject__subject',
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
                    'is_absent': mark.is_absent,
                    'remarks': mark.remarks,
                })

            return Response(list(result.values()))
        except Exception:
            return Response([])


class ParentLeaveRequestViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """
    CRUD for a parent's own leave requests.
    Parents can create, list, retrieve, update (cancel), and delete their own requests.
    """
    required_module = 'parents'
    permission_classes = [IsAuthenticated, IsParentOrAdmin]
    serializer_class = ParentLeaveRequestSerializer
    pagination_class = None

    def get_queryset(self):
        profile = get_parent_profile(self.request)
        if not profile:
            return ParentLeaveRequest.objects.none()

        qs = ParentLeaveRequest.objects.filter(
            parent=profile,
        ).select_related('student', 'reviewed_by')

        school_id = _resolve_school_id(self.request)
        if school_id:
            qs = qs.filter(school_id=school_id)

        return qs

    def perform_create(self, serializer):
        profile = get_parent_profile(self.request)
        if not profile:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Parent profile not found.")

        student_id = self.request.data.get('student')
        if student_id and int(student_id) not in get_parent_children_ids(self.request):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You do not have access to this child.")

        student = Student.objects.get(id=student_id)
        serializer.save(
            parent=profile,
            school=student.school,
        )

    def perform_update(self, serializer):
        """Parents can only cancel their own pending requests."""
        instance = self.get_object()
        if instance.status != 'PENDING':
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Only pending requests can be modified.")
        serializer.save()

    def perform_destroy(self, instance):
        """Parents can only delete pending requests (soft-cancel)."""
        if instance.status != 'PENDING':
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Only pending requests can be deleted.")
        instance.status = 'CANCELLED'
        instance.save(update_fields=['status'])


class ParentMessageViewSet(viewsets.ViewSet):
    """
    Parent messaging:
    - GET  messages/threads/           -- list message threads
    - GET  messages/threads/<uuid>/    -- get messages in a thread
    - POST messages/                   -- send a new message
    - PATCH messages/<int:pk>/read/    -- mark a message as read
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def list_threads(self, request):
        """List distinct message threads for the current user."""
        user = request.user
        school_id = _resolve_school_id(request)

        messages_qs = ParentMessage.objects.filter(
            db_models.Q(sender_user=user) | db_models.Q(recipient_user=user),
        )
        if school_id:
            messages_qs = messages_qs.filter(school_id=school_id)

        # Get distinct threads with latest message
        thread_ids = messages_qs.values_list('thread_id', flat=True).distinct()

        threads = []
        for tid in thread_ids:
            latest = ParentMessage.objects.filter(
                thread_id=tid,
            ).select_related(
                'sender_user', 'recipient_user', 'student',
            ).order_by('-created_at').first()

            if latest:
                unread_count = ParentMessage.objects.filter(
                    thread_id=tid,
                    recipient_user=user,
                    is_read=False,
                ).count()

                threads.append({
                    'thread_id': str(latest.thread_id),
                    'latest_message': latest.message,
                    'latest_message_at': latest.created_at,
                    'sender': latest.sender_user.get_full_name() or latest.sender_user.username,
                    'recipient': latest.recipient_user.get_full_name() or latest.recipient_user.username,
                    'student_name': latest.student.name,
                    'student_id': latest.student_id,
                    'unread_count': unread_count,
                })

        # Sort threads by latest message time descending
        threads.sort(key=lambda t: t['latest_message_at'], reverse=True)
        return Response(threads)

    def get_thread(self, request, thread_id):
        """Get all messages in a specific thread."""
        user = request.user
        messages = ParentMessage.objects.filter(
            thread_id=thread_id,
        ).filter(
            db_models.Q(sender_user=user) | db_models.Q(recipient_user=user),
        ).select_related(
            'sender_user', 'recipient_user', 'student',
        ).order_by('created_at')

        if not messages.exists():
            return Response(
                {'error': 'Thread not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = ParentMessageSerializer(messages, many=True)
        return Response(serializer.data)

    def send_message(self, request):
        """Send a new message (creates new thread or continues existing)."""
        serializer = ParentMessageSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)

        recipient_user_id = request.data.get('recipient_user')
        student_id = request.data.get('student')

        # Verify parent has access to this student
        role = get_effective_role(request)
        if role not in ADMIN_ROLES:
            if student_id and int(student_id) not in get_parent_children_ids(request):
                return Response(
                    {'error': 'You do not have access to this child.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Determine thread_id: re-use existing or create new
        thread_id = request.data.get('thread_id')
        if not thread_id:
            # Check for existing thread between these two users for this student
            existing = ParentMessage.objects.filter(
                student_id=student_id,
            ).filter(
                db_models.Q(
                    sender_user=request.user,
                    recipient_user_id=recipient_user_id,
                ) | db_models.Q(
                    sender_user_id=recipient_user_id,
                    recipient_user=request.user,
                )
            ).values_list('thread_id', flat=True).first()

            thread_id = existing or uuid.uuid4()

        school_id = _resolve_school_id(request)
        student = Student.objects.get(id=student_id)
        school_id = school_id or student.school_id

        msg = ParentMessage.objects.create(
            school_id=school_id,
            thread_id=thread_id,
            sender_user=request.user,
            recipient_user_id=recipient_user_id,
            student_id=student_id,
            message=request.data.get('message', ''),
        )

        return Response(
            ParentMessageSerializer(msg).data,
            status=status.HTTP_201_CREATED,
        )

    def mark_read(self, request, pk):
        """Mark a message as read."""
        try:
            msg = ParentMessage.objects.get(
                id=pk,
                recipient_user=request.user,
            )
        except ParentMessage.DoesNotExist:
            return Response(
                {'error': 'Message not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        msg.is_read = True
        msg.read_at = timezone.now()
        msg.save(update_fields=['is_read', 'read_at'])

        return Response(ParentMessageSerializer(msg).data)


# =============================================================================
# Admin-facing views
# =============================================================================


class AdminParentListView(APIView):
    """
    GET admin/parents/
    List all parents linked to the current school.
    """
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'error': 'school_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parent_links = ParentChild.objects.filter(
            school_id=school_id,
        ).select_related(
            'parent', 'parent__user', 'student', 'student__class_obj',
        )

        # Group by parent
        parents_map = {}
        for link in parent_links:
            pid = link.parent_id
            if pid not in parents_map:
                parents_map[pid] = {
                    'parent': ParentProfileSerializer(link.parent).data,
                    'children': [],
                }
            parents_map[pid]['children'].append({
                'link_id': link.id,
                'student_id': link.student_id,
                'student_name': link.student.name,
                'class_name': link.student.class_obj.name,
                'roll_number': link.student.roll_number,
                'relation': link.relation,
                'is_primary': link.is_primary,
                'can_pickup': link.can_pickup,
            })

        return Response(list(parents_map.values()))


class AdminLinkChildView(APIView):
    """
    POST admin/link-child/
    Link an existing parent to a student.
    Body: {parent_profile_id, student_id, relation, is_primary?, can_pickup?}
    """
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def post(self, request):
        parent_profile_id = request.data.get('parent_profile_id')
        student_id = request.data.get('student_id')
        relation = request.data.get('relation', 'FATHER')
        is_primary = request.data.get('is_primary', False)
        can_pickup = request.data.get('can_pickup', True)

        if not parent_profile_id or not student_id:
            return Response(
                {'error': 'parent_profile_id and student_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            profile = ParentProfile.objects.get(id=parent_profile_id)
        except ParentProfile.DoesNotExist:
            return Response(
                {'error': 'Parent profile not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            student = Student.objects.select_related('school').get(id=student_id)
        except Student.DoesNotExist:
            return Response(
                {'error': 'Student not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if ParentChild.objects.filter(parent=profile, student=student).exists():
            return Response(
                {'error': 'This parent-child link already exists.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        link = ParentChild.objects.create(
            parent=profile,
            student=student,
            school=student.school,
            relation=relation,
            is_primary=is_primary,
            can_pickup=can_pickup,
        )

        return Response(
            ParentChildSerializer(link).data,
            status=status.HTTP_201_CREATED,
        )


class AdminUnlinkChildView(APIView):
    """
    DELETE admin/unlink-child/<int:pk>/
    Remove a parent-child link.
    """
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def delete(self, request, pk):
        try:
            link = ParentChild.objects.get(id=pk)
        except ParentChild.DoesNotExist:
            return Response(
                {'error': 'Parent-child link not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminGenerateInviteView(APIView):
    """
    POST admin/generate-invite/
    Generate a new parent invite code.
    Body: {student_id, relation, parent_phone?}
    """
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def post(self, request):
        serializer = ParentInviteSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        invite = serializer.save()
        return Response(
            ParentInviteSerializer(invite).data,
            status=status.HTTP_201_CREATED,
        )


class AdminLeaveRequestListView(APIView):
    """
    GET  admin/leave-requests/         -- list all leave requests for the school
    PATCH admin/leave-requests/<pk>/review/  -- approve/reject a leave request
    """
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'error': 'school_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = ParentLeaveRequest.objects.filter(
            school_id=school_id,
        ).select_related('parent', 'parent__user', 'student', 'reviewed_by')

        # Optional filters
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter.upper())

        student_id = request.query_params.get('student_id')
        if student_id:
            qs = qs.filter(student_id=student_id)

        serializer = ParentLeaveRequestSerializer(qs, many=True)
        return Response(serializer.data)


class AdminLeaveReviewView(APIView):
    """
    PATCH admin/leave-requests/<int:pk>/review/
    Approve or reject a parent leave request.
    """
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def patch(self, request, pk):
        try:
            leave_request = ParentLeaveRequest.objects.get(id=pk)
        except ParentLeaveRequest.DoesNotExist:
            return Response(
                {'error': 'Leave request not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if leave_request.status != 'PENDING':
            return Response(
                {'error': 'Only pending requests can be reviewed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ParentLeaveReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        leave_request.status = serializer.validated_data['status']
        leave_request.review_note = serializer.validated_data.get('review_note', '')
        leave_request.reviewed_by = request.user
        leave_request.reviewed_at = timezone.now()
        leave_request.save(update_fields=[
            'status', 'review_note', 'reviewed_by', 'reviewed_at',
        ])

        return Response(ParentLeaveRequestSerializer(leave_request).data)
