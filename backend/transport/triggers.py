"""
Transport notification triggers.
Sends push/in-app notifications for transport events using the NotificationEngine.
"""

import logging
from django.utils import timezone
from notifications.recipients import get_admin_users

logger = logging.getLogger(__name__)


def _transport_notification_already_sent(*, school, recipient_user, student, title, body, target_date):
    """Return True when same transport push already exists for recipient/student/day."""
    from notifications.models import NotificationLog

    return NotificationLog.objects.filter(
        school=school,
        event_type='TRANSPORT_UPDATE',
        channel='PUSH',
        recipient_user=recipient_user,
        student=student,
        title=title,
        body=body,
        created_at__date=target_date,
        status__in=['PENDING', 'SCHEDULED', 'SENT', 'DELIVERED', 'READ'],
    ).exists()


def _get_parent_users_for_students(students, school):
    """Resolve ParentChild links and return {student_id: [parent_user, ...]} mapping."""
    from parents.models import ParentChild

    links = (
        ParentChild.objects
        .filter(school=school, student__in=students)
        .select_related('parent__user', 'student')
    )
    results = {}
    for link in links:
        parent_user = getattr(getattr(link, 'parent', None), 'user', None)
        if not parent_user:
            continue
        student_id = link.student_id
        if student_id not in results:
            results[student_id] = {}
        results[student_id][parent_user.id] = parent_user

    return {
        student_id: list(user_map.values())
        for student_id, user_map in results.items()
    }


def _get_parent_users_for_route(route):
    """
    Get parent User objects for all students actively assigned to a route.
    Returns list of (parent_user, student) tuples.
    """
    from .models import TransportAssignment

    assignments = TransportAssignment.objects.filter(
        route=route, is_active=True,
    ).select_related('student')
    students = [assignment.student for assignment in assignments if assignment.student_id]
    parent_users_by_student_id = _get_parent_users_for_students(students, route.school)

    results = []
    for assignment in assignments:
        student = assignment.student
        for parent_user in parent_users_by_student_id.get(student.id, []):
            results.append((parent_user, student))

    return results


def _get_parent_users_for_stop(route, stop):
    """
    Get parent User objects for students assigned to a specific stop on a route.
    Returns list of (parent_user, student) tuples.
    """
    from .models import TransportAssignment

    assignments = TransportAssignment.objects.filter(
        route=route, stop=stop, is_active=True,
    ).select_related('student')
    students = [assignment.student for assignment in assignments if assignment.student_id]
    parent_users_by_student_id = _get_parent_users_for_students(students, route.school)

    results = []
    for assignment in assignments:
        student = assignment.student
        for parent_user in parent_users_by_student_id.get(student.id, []):
            results.append((parent_user, student))

    return results


def _is_transport_notification_enabled(school):
    """Check if transport notifications are enabled for this school."""
    from notifications.models import SchoolNotificationConfig
    try:
        config = school.notification_config
        return config.transport_notification_enabled
    except SchoolNotificationConfig.DoesNotExist:
        return True  # Default enabled if no config exists


def trigger_bus_departed(route_journey):
    """
    Send notification when a bus departs on a route.
    Notifies all parents of students assigned to the route.

    Args:
        route_journey: RouteJourney instance (status=ACTIVE)
    """
    from notifications.engine import NotificationEngine

    school = route_journey.school
    if not _is_transport_notification_enabled(school):
        return 0
    route = route_journey.route

    engine = NotificationEngine(school)
    parent_students = _get_parent_users_for_route(route)

    sent_count = 0
    target_date = timezone.localdate()
    for parent_user, student in parent_students:
        title = f'Bus Departed - {route.name}'
        body = f'Bus on {route.name} has departed ({route_journey.get_journey_type_display()}).'
        context = {
            'route_name': route.name,
            'student_name': student.name,
            'school_name': school.name,
            'journey_type': route_journey.get_journey_type_display(),
            'status': 'departed',
        }

        try:
            if _transport_notification_already_sent(
                school=school,
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
                target_date=target_date,
            ):
                logger.info(
                    "Skipped transport departure notification",
                    extra={'reason_code': 'skipped_due_to_dedupe', 'recipient_user_id': parent_user.id},
                )
                continue

            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='PUSH',
                context=context,
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
            )
            sent_count += 1
        except Exception:
            logger.exception(f"Failed to send departure notification to parent {parent_user.id}")

    # Also send in-app to admins
    _notify_admins_in_app(
        engine, school,
        title=f'Route {route.name} - Bus Departed',
        body=f'Bus departed on {route.name} ({route_journey.get_tracking_mode_display()}).',
    )

    logger.info(f"Bus departed notifications sent: {sent_count} parents for route {route.name}")
    return sent_count


def trigger_bus_arriving_stop(route_journey, stop):
    """
    Send notification when a bus is approaching a stop (geofence triggered).
    Notifies parents of students assigned to that specific stop.

    Args:
        route_journey: RouteJourney instance (status=ACTIVE)
        stop: TransportStop instance
    """
    from notifications.engine import NotificationEngine

    school = route_journey.school
    if not _is_transport_notification_enabled(school):
        return 0
    route = route_journey.route

    engine = NotificationEngine(school)
    parent_students = _get_parent_users_for_stop(route, stop)

    sent_count = 0
    target_date = timezone.localdate()
    for parent_user, student in parent_students:
        title = f'Bus Arriving - {stop.name}'
        body = f'Bus on {route.name} is arriving at {stop.name}.'
        context = {
            'route_name': route.name,
            'stop_name': stop.name,
            'student_name': student.name,
            'school_name': school.name,
            'status': 'arriving',
        }

        try:
            if _transport_notification_already_sent(
                school=school,
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
                target_date=target_date,
            ):
                logger.info(
                    "Skipped transport geofence notification",
                    extra={'reason_code': 'skipped_due_to_dedupe', 'recipient_user_id': parent_user.id},
                )
                continue

            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='PUSH',
                context=context,
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
            )
            sent_count += 1
        except Exception:
            logger.exception(f"Failed to send geofence notification to parent {parent_user.id}")

    logger.info(f"Bus arriving notifications sent: {sent_count} parents for stop {stop.name}")
    return sent_count


def trigger_journey_completed(route_journey):
    """
    Send notification when a route journey is completed.
    Notifies all parents of students on the route.

    Args:
        route_journey: RouteJourney instance (status=COMPLETED)
    """
    from notifications.engine import NotificationEngine

    school = route_journey.school
    if not _is_transport_notification_enabled(school):
        return 0
    route = route_journey.route

    engine = NotificationEngine(school)
    parent_students = _get_parent_users_for_route(route)

    sent_count = 0
    target_date = timezone.localdate()
    for parent_user, student in parent_students:
        title = f'Journey Completed - {route.name}'
        body = f"Bus on {route.name} has completed today's {route_journey.get_journey_type_display().lower()} run."
        context = {
            'route_name': route.name,
            'student_name': student.name,
            'school_name': school.name,
            'journey_type': route_journey.get_journey_type_display(),
            'status': 'completed',
        }

        try:
            if _transport_notification_already_sent(
                school=school,
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
                target_date=target_date,
            ):
                logger.info(
                    "Skipped transport completion notification",
                    extra={'reason_code': 'skipped_due_to_dedupe', 'recipient_user_id': parent_user.id},
                )
                continue

            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='PUSH',
                context=context,
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
            )
            sent_count += 1
        except Exception:
            logger.exception(f"Failed to send completion notification to parent {parent_user.id}")

    logger.info(f"Journey completed notifications sent: {sent_count} parents for route {route.name}")
    return sent_count


def _notify_admins_in_app(engine, school, title, body):
    """Send an in-app notification to school admins."""
    admins = get_admin_users(school)[:5]

    for admin_user in admins:
        try:
            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='IN_APP',
                context={},
                recipient_identifier=str(admin_user.id),
                recipient_type='ADMIN',
                recipient_user=admin_user,
                title=title,
                body=body,
            )
        except Exception:
            logger.exception(f"Failed to send in-app notification to admin {admin_user.id}")
