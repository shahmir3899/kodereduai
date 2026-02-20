"""
Transport notification triggers.
Sends push/in-app notifications for transport events using the NotificationEngine.
"""

import logging

logger = logging.getLogger(__name__)


def _get_parent_users_for_route(route):
    """
    Get parent User objects for all students actively assigned to a route.
    Returns list of (parent_user, student) tuples.
    """
    from .models import TransportAssignment

    assignments = TransportAssignment.objects.filter(
        route=route, is_active=True,
    ).select_related('student', 'student__user')

    results = []
    for assignment in assignments:
        student = assignment.student
        # Try to find parent user via parent relationship
        parent_user = None
        if hasattr(student, 'parent') and student.parent:
            parent_user = getattr(student.parent, 'user', None)

        if parent_user:
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
    ).select_related('student', 'student__user')

    results = []
    for assignment in assignments:
        student = assignment.student
        parent_user = None
        if hasattr(student, 'parent') and student.parent:
            parent_user = getattr(student.parent, 'user', None)

        if parent_user:
            results.append((parent_user, student))

    return results


def trigger_bus_departed(route_journey):
    """
    Send notification when a bus departs on a route.
    Notifies all parents of students assigned to the route.

    Args:
        route_journey: RouteJourney instance (status=ACTIVE)
    """
    from notifications.engine import NotificationEngine

    school = route_journey.school
    route = route_journey.route

    engine = NotificationEngine(school)
    parent_students = _get_parent_users_for_route(route)

    sent_count = 0
    for parent_user, student in parent_students:
        context = {
            'route_name': route.name,
            'student_name': student.name,
            'school_name': school.name,
            'journey_type': route_journey.get_journey_type_display(),
            'status': 'departed',
        }

        try:
            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='PUSH',
                context=context,
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=f'Bus Departed - {route.name}',
                body=f'Bus on {route.name} has departed ({route_journey.get_journey_type_display()}).',
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
    route = route_journey.route

    engine = NotificationEngine(school)
    parent_students = _get_parent_users_for_stop(route, stop)

    sent_count = 0
    for parent_user, student in parent_students:
        context = {
            'route_name': route.name,
            'stop_name': stop.name,
            'student_name': student.name,
            'school_name': school.name,
            'status': 'arriving',
        }

        try:
            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='PUSH',
                context=context,
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=f'Bus Arriving - {stop.name}',
                body=f'Bus on {route.name} is arriving at {stop.name}.',
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
    route = route_journey.route

    engine = NotificationEngine(school)
    parent_students = _get_parent_users_for_route(route)

    sent_count = 0
    for parent_user, student in parent_students:
        context = {
            'route_name': route.name,
            'student_name': student.name,
            'school_name': school.name,
            'journey_type': route_journey.get_journey_type_display(),
            'status': 'completed',
        }

        try:
            engine.send(
                event_type='TRANSPORT_UPDATE',
                channel='PUSH',
                context=context,
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=f'Journey Completed - {route.name}',
                body=f'Bus on {route.name} has completed today\'s {route_journey.get_journey_type_display().lower()} run.',
            )
            sent_count += 1
        except Exception:
            logger.exception(f"Failed to send completion notification to parent {parent_user.id}")

    logger.info(f"Journey completed notifications sent: {sent_count} parents for route {route.name}")
    return sent_count


def _notify_admins_in_app(engine, school, title, body):
    """Send an in-app notification to school admins."""
    from users.models import User

    admins = User.objects.filter(
        school=school,
        role__in=['SCHOOL_ADMIN', 'PRINCIPAL'],
    )[:5]

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
