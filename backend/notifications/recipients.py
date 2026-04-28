"""
Shared recipient resolution helpers for notification triggers.
"""

from schools.models import UserSchoolMembership


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
    """Return school admins and principals using membership mapping."""
    return get_school_membership_users(
        school,
        roles=[
            UserSchoolMembership.Role.SCHOOL_ADMIN,
            UserSchoolMembership.Role.PRINCIPAL,
        ],
    )


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