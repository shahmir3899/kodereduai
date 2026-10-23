"""Backfill for student and parent accounts created while User.Role had no STUDENT/PARENT.

Those accounts were saved with base role STAFF (their real role is the school membership).
This is called by migration 0009 with the historical models, so it takes the models as
arguments instead of importing them.
"""

PORTAL_ROLES = ('STUDENT', 'PARENT')


def backfill_portal_roles(User, Membership):
    """Give existing portal accounts their own base role. Returns {'converted': n, 'review': [user ids]}.

    Deliberately conservative: only an account that still has role STAFF, holds exactly one
    kind of portal profile, and whose active memberships are all STUDENT/PARENT is converted.
    Anyone else with a profile (a staff member who is also a parent, an account with both
    profiles) keeps their role and is returned in `review` for a person to decide.
    """
    converted = 0
    review = []

    candidates = User.objects.filter(role='STAFF').filter(
        _has_profile('student_profile') | _has_profile('parent_profile'),
    ).distinct()

    for user in candidates:
        is_student = hasattr(user, 'student_profile')
        is_parent = hasattr(user, 'parent_profile')
        if is_student and is_parent:
            review.append(user.pk)
            continue

        memberships = set(
            Membership.objects.filter(user=user, is_active=True).values_list('role', flat=True),
        )
        if not memberships <= set(PORTAL_ROLES):
            review.append(user.pk)
            continue

        user.role = 'STUDENT' if is_student else 'PARENT'
        user.save(update_fields=['role'])
        converted += 1

    return {'converted': converted, 'review': review}


def restore_portal_roles(User):
    """Reverse of the backfill: portal accounts go back to the old base role STAFF."""
    return User.objects.filter(role__in=PORTAL_ROLES).update(role='STAFF')


def _has_profile(relation):
    from django.db.models import Q

    return Q(**{f'{relation}__isnull': False})
