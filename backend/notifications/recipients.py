"""
Shared recipient resolution helpers for notification triggers.
"""

from schools.models import School, UserSchoolMembership
from users.models import User


def get_school_membership_users(school, roles):
    """Return active users for the given school and membership roles."""
    memberships = (
        UserSchoolMembership.objects
        .filter(
            school=school,
            role__in=roles,
            is_active=True,
        )
        .select_related('user')
    )
    users_by_id = {}
    for membership in memberships:
        if membership.user_id:
            users_by_id[membership.user_id] = membership.user
    return list(users_by_id.values())


def get_admin_users(school):
    """Return school admins/principals for in-app and scheduled notifications.

    Primary source is ``UserSchoolMembership`` with roles SCHOOL_ADMIN or
    PRINCIPAL. When ``school`` belongs to an :class:`~schools.models.Organization`,
    the same roles on **any active sibling school** in that org are included.
    That way branch-scoped work (e.g. ``NotificationEngine(branch_school)``)
    still reaches org-level admins whose membership row may sit on another
    branch (common for "Branch 1" in the UI vs membership on head office).

    Legacy fallback: active users with ``User.school_id`` in that school set
    and global role SCHOOL_ADMIN / PRINCIPAL (deprecated FK, still used in data).
    """
    roles = [
        UserSchoolMembership.Role.SCHOOL_ADMIN,
        UserSchoolMembership.Role.PRINCIPAL,
    ]

    org_id = getattr(school, 'organization_id', None)
    if org_id:
        school_ids = list(
            School.objects.filter(
                organization_id=org_id,
                is_active=True,
            ).values_list('id', flat=True)
        )
    else:
        school_ids = [school.pk]

    users_by_id = {}
    memberships = (
        UserSchoolMembership.objects.filter(
            school_id__in=school_ids,
            role__in=roles,
            is_active=True,
        ).select_related('user')
    )
    for membership in memberships:
        if membership.user_id:
            users_by_id[membership.user_id] = membership.user

    fallback_users = User.objects.filter(
        school_id__in=school_ids,
        is_active=True,
        role__in=['SCHOOL_ADMIN', 'PRINCIPAL'],
    )
    for user in fallback_users:
        if user.id:
            users_by_id[user.id] = user

    return list(users_by_id.values())


def get_parent_users_for_student(student):
    """Return linked parent users for the given student via ParentChild."""
    from parents.models import ParentChild

    links = (
        ParentChild.objects
        .filter(school=student.school, student=student)
        .select_related('parent__user')
    )
    users_by_id = {}
    for link in links:
        parent_user = getattr(getattr(link, 'parent', None), 'user', None)
        if parent_user:
            users_by_id[parent_user.id] = parent_user
    return list(users_by_id.values())


def get_student_user(student):
    """Return linked student portal user via StudentProfile, if present."""
    profile = getattr(student, 'user_profile', None)
    if profile and profile.user:
        return profile.user
    return None