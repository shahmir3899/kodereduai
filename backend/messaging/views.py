from django.db import transaction
from django.db.models import Q, Count
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
                # Use the per-school membership role, not the base User.role —
                # a multi-school user's role can differ per school (e.g. Teacher
                # at one, Manager at another), and base role would show the
                # wrong one for whichever school isn't their "home" assignment.
                recipient_role = (s.user.get_role_for_school(school_id) or s.user.role) if s.user else 'STAFF'
                recipients.append({
                    'id': s.user_id,
                    'name': s.full_name,
                    'role': recipient_role,
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
                # Students in the sections this teacher teaches this year.
                # Scoping by master class (and the Student.class_obj snapshot)
                # let a Class 2-A teacher message Class 2-B families.
                students, label_by_student = _students_taught_by(staff_member, school_id)

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
                                'class_name': label_by_student.get(link.student_id),
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
                        'class_name': label_by_student.get(sp.student_id),
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
                # Teachers of the child's own section, not every section of
                # the master class.
                class_subjects, class_label = _class_subjects_for_student(link.student, school_id)
                class_subjects = class_subjects.filter(
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
                            'class_name': class_label,
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

    class_subjects, _label = _class_subjects_for_student(student, school_id)
    return class_subjects.filter(teacher=staff_member).exists()


def _class_subjects_for_student(student, school_id):
    """(ClassSubject queryset, class label) for the student's current section.

    Falls back to the master class for schools without academic years or a
    student with no enrollment this year.
    """
    from academic_sessions.roster import current_placement

    qs = ClassSubject.objects.filter(school_id=school_id, is_active=True)
    placement = current_placement(student)
    if placement and placement.session_class_id:
        return qs.filter(session_class_id=placement.session_class_id), placement.session_class.label
    if placement:
        return (
            qs.filter(class_obj_id=placement.class_obj_id, academic_year_id=placement.academic_year_id),
            placement.class_obj.name,
        )
    return qs.filter(class_obj_id=student.class_obj_id), (student.class_obj.name if student.class_obj else None)


def _students_taught_by(staff_member, school_id):
    """(active students in the teacher's current-year sections, {student_id: section label})."""
    from academic_sessions.models import StudentEnrollment
    from academic_sessions.utils import resolve_current_academic_year_id

    year_id = resolve_current_academic_year_id(school_id)
    taught = ClassSubject.objects.filter(teacher=staff_member, school_id=school_id, is_active=True)
    if not year_id:
        students = Student.objects.filter(
            class_obj_id__in=taught.values('class_obj_id'), school_id=school_id, is_active=True,
        ).select_related('class_obj')
        return students, {s.id: s.class_obj.name if s.class_obj else None for s in students}

    taught = taught.filter(academic_year_id=year_id)
    section_ids = [sid for sid in taught.values_list('session_class_id', flat=True) if sid]
    master_only_ids = list(taught.filter(session_class__isnull=True).values_list('class_obj_id', flat=True))
    enrollments = StudentEnrollment.objects.filter(
        Q(session_class_id__in=section_ids)
        | Q(session_class__isnull=True, class_obj_id__in=master_only_ids),
        school_id=school_id,
        academic_year_id=year_id,
        is_active=True,
    ).select_related('session_class', 'class_obj')
    label_by_student = {
        e.student_id: e.session_class.label if e.session_class_id else e.class_obj.name
        for e in enrollments
    }
    students = Student.objects.filter(id__in=label_by_student, school_id=school_id, is_active=True)
    return students, label_by_student


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
    return qs.annotate(
        participant_count=Count('participants')
    ).filter(participant_count=2).first()
