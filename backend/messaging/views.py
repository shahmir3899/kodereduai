from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.contrib.auth import get_user_model
from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import ensure_tenant_school_id
from core.permissions import get_effective_role, ADMIN_ROLES, STAFF_LEVEL_ROLES
from academics.models import ClassSubject
from students.models import Student, StudentProfile
from parents.models import ParentChild, ParentProfile
from hr.models import StaffMember
from schools.models import UserSchoolMembership

from .models import MessageThread, ThreadParticipant, Message
from .serializers import (
    ThreadListSerializer, ThreadDetailSerializer,
    MessageSerializer, NewThreadSerializer, ReplySerializer,
)

User = get_user_model()


class MessagingViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list_threads(self, request):
        """GET /api/messaging/threads/ - List user's threads."""
        school_id = ensure_tenant_school_id(request)
        user = request.user

        thread_ids = ThreadParticipant.objects.filter(
            user=user,
        ).values_list('thread_id', flat=True)

        threads = MessageThread.objects.filter(
            id__in=thread_ids,
            is_active=True,
        ).prefetch_related(
            'participants', 'participants__user', 'messages',
        ).select_related('student')

        if school_id:
            threads = threads.filter(school_id=school_id)

        serializer = ThreadListSerializer(
            threads, many=True, context={'request': request}
        )
        return Response(serializer.data)

    def get_thread(self, request, thread_id):
        """GET /api/messaging/threads/<uuid>/ - Get thread messages, marks as read."""
        user = request.user

        try:
            participation = ThreadParticipant.objects.get(
                thread_id=thread_id, user=user,
            )
        except ThreadParticipant.DoesNotExist:
            return Response(
                {'error': 'Thread not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        thread = MessageThread.objects.filter(
            id=thread_id,
        ).prefetch_related(
            'participants', 'participants__user',
            'messages', 'messages__sender',
        ).select_related('student').first()

        # Mark as read
        participation.last_read_at = timezone.now()
        participation.save(update_fields=['last_read_at'])

        serializer = ThreadDetailSerializer(
            thread, context={'request': request}
        )
        return Response(serializer.data)

    def create_thread(self, request):
        """POST /api/messaging/threads/ - Create thread with first message."""
        serializer = NewThreadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user
        school_id = ensure_tenant_school_id(request) or getattr(user, 'school_id', None)
        role = get_effective_role(request)
        recipient_user_id = data['recipient_user_id']
        student_id = data.get('student_id')
        message_type = data.get('message_type', 'GENERAL')

        # Validate recipient exists
        try:
            recipient = User.objects.get(id=recipient_user_id)
        except User.DoesNotExist:
            return Response(
                {'error': 'Recipient not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Validate teacher scope
        if role == 'TEACHER' and message_type in ('TEACHER_PARENT', 'TEACHER_STUDENT'):
            if not student_id:
                return Response(
                    {'error': 'Student context required for teacher messaging.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not _teacher_has_student_access(user, student_id, school_id):
                return Response(
                    {'error': 'You can only message students/parents in classes you teach.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Validate parent scope
        if role == 'PARENT':
            if student_id:
                try:
                    profile = user.parent_profile
                    if not ParentChild.objects.filter(
                        parent=profile, student_id=student_id
                    ).exists():
                        return Response(
                            {'error': 'You do not have access to this child.'},
                            status=status.HTTP_403_FORBIDDEN,
                        )
                except ParentProfile.DoesNotExist:
                    return Response(
                        {'error': 'Parent profile not found.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        # Check for existing thread between these participants + student
        existing_thread = _find_existing_thread(
            user.id, recipient_user_id, student_id, school_id
        )
        if existing_thread:
            Message.objects.create(
                thread=existing_thread,
                sender=user,
                body=data['message'],
            )
            existing_thread.updated_at = timezone.now()
            existing_thread.save(update_fields=['updated_at'])

            # Refresh prefetch
            existing_thread = MessageThread.objects.filter(
                id=existing_thread.id,
            ).prefetch_related(
                'participants', 'participants__user',
                'messages', 'messages__sender',
            ).select_related('student').first()

            return Response(
                ThreadDetailSerializer(existing_thread, context={'request': request}).data,
                status=status.HTTP_200_OK,
            )

        # Create new thread
        with transaction.atomic():
            thread = MessageThread.objects.create(
                school_id=school_id,
                message_type=message_type,
                student_id=student_id,
                subject=data.get('subject', ''),
                created_by=user,
            )
            ThreadParticipant.objects.create(
                thread=thread, user=user, last_read_at=timezone.now()
            )
            ThreadParticipant.objects.create(
                thread=thread, user=recipient
            )
            Message.objects.create(
                thread=thread,
                sender=user,
                body=data['message'],
            )

        # Refresh for serializer
        thread = MessageThread.objects.filter(
            id=thread.id,
        ).prefetch_related(
            'participants', 'participants__user',
            'messages', 'messages__sender',
        ).select_related('student').first()

        return Response(
            ThreadDetailSerializer(thread, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def reply(self, request, thread_id):
        """POST /api/messaging/threads/<uuid>/reply/ - Reply to thread."""
        serializer = ReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        try:
            participation = ThreadParticipant.objects.get(
                thread_id=thread_id, user=user,
            )
        except ThreadParticipant.DoesNotExist:
            return Response(
                {'error': 'Thread not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        msg = Message.objects.create(
            thread_id=thread_id,
            sender=user,
            body=serializer.validated_data['message'],
        )

        MessageThread.objects.filter(id=thread_id).update(updated_at=timezone.now())
        participation.last_read_at = timezone.now()
        participation.save(update_fields=['last_read_at'])

        return Response(
            MessageSerializer(msg, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def mark_read(self, request, thread_id):
        """PATCH /api/messaging/threads/<uuid>/read/ - Mark thread as read."""
        user = request.user
        try:
            participation = ThreadParticipant.objects.get(
                thread_id=thread_id, user=user,
            )
        except ThreadParticipant.DoesNotExist:
            return Response(
                {'error': 'Thread not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        participation.last_read_at = timezone.now()
        participation.save(update_fields=['last_read_at'])
        return Response({'status': 'ok'})

    def list_recipients(self, request):
        """GET /api/messaging/recipients/ - Role-based available recipients."""
        school_id = ensure_tenant_school_id(request) or getattr(request.user, 'school_id', None)
        role = get_effective_role(request)
        user = request.user
        recipients = []

        if role in ADMIN_ROLES:
            # Admins can message any staff member in the school
            staff = StaffMember.objects.filter(
                school_id=school_id,
                is_active=True,
                user__isnull=False,
            ).exclude(user=user).select_related('user', 'department')

            for s in staff:
                recipients.append({
                    'id': s.user_id,
                    'name': s.full_name,
                    'role': s.user.role if s.user else 'STAFF',
                    'department': s.department.name if s.department else None,
                    'student_id': None,
                    'student_name': None,
                    'class_name': None,
                })

        elif role == 'TEACHER':
            try:
                staff_member = user.staff_profile
            except StaffMember.DoesNotExist:
                staff_member = None

            if staff_member:
                # Classes this teacher teaches
                taught_class_ids = ClassSubject.objects.filter(
                    teacher=staff_member,
                    school_id=school_id,
                    is_active=True,
                ).values_list('class_obj_id', flat=True).distinct()

                # Students in those classes
                students = Student.objects.filter(
                    class_obj_id__in=taught_class_ids,
                    school_id=school_id,
                    is_active=True,
                ).select_related('class_obj')

                # Parents of those students
                parent_links = ParentChild.objects.filter(
                    student__in=students,
                    school_id=school_id,
                ).select_related('parent', 'parent__user', 'student', 'student__class_obj')

                seen = set()
                for link in parent_links:
                    if link.parent.user_id:
                        key = (link.parent.user_id, link.student_id)
                        if key not in seen:
                            seen.add(key)
                            recipients.append({
                                'id': link.parent.user_id,
                                'name': link.parent.user.get_full_name() or link.parent.user.username,
                                'role': 'PARENT',
                                'department': None,
                                'student_id': link.student_id,
                                'student_name': link.student.name,
                                'class_name': link.student.class_obj.name if link.student.class_obj else None,
                            })

                # Students with user accounts
                student_profiles = StudentProfile.objects.filter(
                    student__in=students,
                ).select_related('user', 'student', 'student__class_obj')

                for sp in student_profiles:
                    recipients.append({
                        'id': sp.user_id,
                        'name': sp.user.get_full_name() or sp.user.username,
                        'role': 'STUDENT',
                        'department': None,
                        'student_id': sp.student_id,
                        'student_name': sp.student.name,
                        'class_name': sp.student.class_obj.name if sp.student.class_obj else None,
                    })

            # Teachers can also message admins
            admin_memberships = UserSchoolMembership.objects.filter(
                school_id=school_id,
                role__in=['SCHOOL_ADMIN', 'PRINCIPAL'],
            ).exclude(user=user).select_related('user')

            seen_admins = set()
            for m in admin_memberships:
                if m.user_id not in seen_admins:
                    seen_admins.add(m.user_id)
                    recipients.append({
                        'id': m.user_id,
                        'name': m.user.get_full_name() or m.user.username,
                        'role': m.role,
                        'department': None,
                        'student_id': None,
                        'student_name': None,
                        'class_name': None,
                    })

        elif role in STAFF_LEVEL_ROLES:
            # Other staff can message admins
            admin_memberships = UserSchoolMembership.objects.filter(
                school_id=school_id,
                role__in=['SCHOOL_ADMIN', 'PRINCIPAL'],
            ).exclude(user=user).select_related('user')

            for m in admin_memberships:
                recipients.append({
                    'id': m.user_id,
                    'name': m.user.get_full_name() or m.user.username,
                    'role': m.role,
                    'department': None,
                    'student_id': None,
                    'student_name': None,
                    'class_name': None,
                })

        elif role == 'PARENT':
            # Parents can message teachers of their children
            try:
                profile = user.parent_profile
            except ParentProfile.DoesNotExist:
                return Response(recipients)

            child_links = ParentChild.objects.filter(
                parent=profile,
                school_id=school_id,
            ).select_related('student', 'student__class_obj')

            seen = set()
            for link in child_links:
                if not link.student.class_obj:
                    continue
                class_subjects = ClassSubject.objects.filter(
                    class_obj=link.student.class_obj,
                    school_id=school_id,
                    is_active=True,
                    teacher__isnull=False,
                    teacher__user__isnull=False,
                ).select_related('teacher', 'teacher__user')

                for cs in class_subjects:
                    key = (cs.teacher.user_id, link.student_id)
                    if key not in seen:
                        seen.add(key)
                        recipients.append({
                            'id': cs.teacher.user_id,
                            'name': cs.teacher.full_name,
                            'role': 'TEACHER',
                            'department': None,
                            'student_id': link.student_id,
                            'student_name': link.student.name,
                            'class_name': link.student.class_obj.name,
                        })

        return Response(recipients)

    def unread_count(self, request):
        """GET /api/messaging/unread-count/ - Total unread for badge."""
        user = request.user
        school_id = ensure_tenant_school_id(request)

        participations = ThreadParticipant.objects.filter(
            user=user,
            thread__is_active=True,
        )

        if school_id:
            participations = participations.filter(thread__school_id=school_id)

        total_unread = 0
        for p in participations:
            qs = Message.objects.filter(thread_id=p.thread_id).exclude(sender=user)
            if p.last_read_at:
                qs = qs.filter(created_at__gt=p.last_read_at)
            total_unread += qs.count()

        return Response({'unread_count': total_unread})


def _teacher_has_student_access(user, student_id, school_id):
    """Check if teacher teaches a class that the student belongs to."""
    try:
        staff_member = user.staff_profile
    except StaffMember.DoesNotExist:
        return False

    student = Student.objects.filter(id=student_id, school_id=school_id).first()
    if not student:
        return False

    return ClassSubject.objects.filter(
        teacher=staff_member,
        class_obj=student.class_obj,
        school_id=school_id,
        is_active=True,
    ).exists()


def _find_existing_thread(user_id, recipient_user_id, student_id, school_id):
    """Find an existing active thread between two users with same student context."""
    user_threads = set(ThreadParticipant.objects.filter(
        user_id=user_id,
    ).values_list('thread_id', flat=True))

    recipient_threads = set(ThreadParticipant.objects.filter(
        user_id=recipient_user_id,
    ).values_list('thread_id', flat=True))

    common = user_threads & recipient_threads
    if not common:
        return None

    qs = MessageThread.objects.filter(
        id__in=common,
        is_active=True,
    )
    if school_id:
        qs = qs.filter(school_id=school_id)

    if student_id:
        qs = qs.filter(student_id=student_id)
    else:
        qs = qs.filter(student__isnull=True)

    # Return first 2-person thread
    for thread in qs:
        if thread.participants.count() == 2:
            return thread
    return None
