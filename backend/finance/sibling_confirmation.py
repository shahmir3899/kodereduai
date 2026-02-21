"""
Sibling confirmation logic.

When an admin confirms a sibling suggestion:
1. Create or extend a SiblingGroup
2. Assign order_index based on admission date
3. Auto-create StudentDiscount records for non-eldest siblings
"""
import logging
from django.db import models, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


def confirm_sibling_suggestion(suggestion, confirmed_by_user):
    """
    Confirm a SiblingSuggestion:
    - Create/join SiblingGroup
    - Create SiblingGroupMember records
    - Auto-assign sibling discount to non-eldest members
    Returns the SiblingGroup.
    """
    from finance.models import (
        SiblingGroup, SiblingGroupMember, SiblingSuggestion,
    )

    student_a = suggestion.student_a
    student_b = suggestion.student_b
    school_id = suggestion.school_id

    with transaction.atomic():
        # Find existing groups for either student
        a_membership = SiblingGroupMember.objects.filter(
            student=student_a, group__is_active=True, group__school_id=school_id,
        ).select_related('group').first()

        b_membership = SiblingGroupMember.objects.filter(
            student=student_b, group__is_active=True, group__school_id=school_id,
        ).select_related('group').first()

        if a_membership and b_membership:
            if a_membership.group_id == b_membership.group_id:
                # Already in same group
                group = a_membership.group
            else:
                # Merge: move all of group B into group A
                group = a_membership.group
                SiblingGroupMember.objects.filter(
                    group=b_membership.group,
                ).update(group=group)
                old_group = b_membership.group
                old_group.is_active = False
                old_group.save(update_fields=['is_active', 'updated_at'])
        elif a_membership:
            group = a_membership.group
            SiblingGroupMember.objects.get_or_create(
                group=group, student=student_b,
                defaults={'order_index': group.members.count()},
            )
        elif b_membership:
            group = b_membership.group
            SiblingGroupMember.objects.get_or_create(
                group=group, student=student_a,
                defaults={'order_index': group.members.count()},
            )
        else:
            # Create new group
            group = SiblingGroup.objects.create(
                school_id=school_id,
                confirmed_by=confirmed_by_user,
                confirmed_at=timezone.now(),
            )
            # Determine order by admission_date, then created_at
            students_ordered = sorted(
                [student_a, student_b],
                key=lambda s: (s.admission_date or s.created_at.date(), s.id),
            )
            for idx, student in enumerate(students_ordered):
                SiblingGroupMember.objects.create(
                    group=group, student=student, order_index=idx,
                )

        # Recompute order indexes for all members
        _recompute_order_indexes(group)

        # Update group name
        _update_group_name(group)

        # Mark suggestion as confirmed
        now = timezone.now()
        suggestion.status = 'CONFIRMED'
        suggestion.reviewed_by = confirmed_by_user
        suggestion.reviewed_at = now
        suggestion.sibling_group = group
        suggestion.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'sibling_group'])

        # Auto-confirm other pending suggestions involving these students
        # that point to the same pair or sub-pair within this group
        member_ids = list(
            group.members.values_list('student_id', flat=True)
        )
        SiblingSuggestion.objects.filter(
            school_id=school_id,
            status='PENDING',
        ).filter(
            models.Q(student_a_id__in=member_ids, student_b_id__in=member_ids)
        ).exclude(id=suggestion.id).update(
            status='CONFIRMED',
            reviewed_by=confirmed_by_user,
            reviewed_at=now,
            sibling_group=group,
        )

        # Auto-assign sibling discount
        _assign_sibling_discounts(group, confirmed_by_user)

    return group


def _recompute_order_indexes(group):
    """Reorder members by admission_date (earliest = 0 = eldest)."""
    members = list(group.members.select_related('student').all())
    members.sort(key=lambda m: (
        m.student.admission_date or m.student.created_at.date(),
        m.student.id,
    ))
    for idx, member in enumerate(members):
        if member.order_index != idx:
            member.order_index = idx
            member.save(update_fields=['order_index'])


def _update_group_name(group):
    """Auto-generate group name from parent's name or first student's last name."""
    members = group.members.select_related('student').order_by('order_index').all()
    if not members:
        return

    first_student = members[0].student
    # Try parent_name first, fall back to student's last name
    if first_student.parent_name and first_student.parent_name.strip():
        family_label = first_student.parent_name.strip().split()[-1]
    else:
        family_label = first_student.name.strip().split()[-1]

    group.name = f"{family_label} Family ({members.count()} siblings)"
    group.save(update_fields=['name', 'updated_at'])


def _assign_sibling_discounts(group, confirmed_by_user):
    """
    For each non-eldest member (order_index >= 1), create a StudentDiscount
    linking them to the school's active SIBLING discount.
    """
    from finance.models import Discount, StudentDiscount
    from academic_sessions.models import AcademicYear

    school_id = group.school_id

    # Find the active sibling discount for this school
    sibling_discount = Discount.objects.filter(
        school_id=school_id,
        applies_to='SIBLING',
        is_active=True,
    ).first()

    if not sibling_discount:
        logger.info(
            f"No active SIBLING discount for school {school_id}. "
            f"Sibling group {group.id} created without auto-discount."
        )
        return

    # Get current academic year
    current_year = AcademicYear.objects.filter(
        school_id=school_id, is_current=True,
    ).first()
    if not current_year:
        logger.warning(
            f"No current academic year for school {school_id}. "
            f"Cannot assign sibling discount."
        )
        return

    members = group.members.select_related('student').order_by('order_index').all()
    now = timezone.now()

    for member in members:
        if member.order_index == 0:
            # Eldest pays full -- deactivate any stale sibling discount
            StudentDiscount.objects.filter(
                student=member.student,
                discount=sibling_discount,
                academic_year=current_year,
            ).update(is_active=False)
            continue

        # Create or reactivate discount for non-eldest
        sd, created = StudentDiscount.objects.get_or_create(
            school_id=school_id,
            student=member.student,
            discount=sibling_discount,
            academic_year=current_year,
            defaults={
                'approved_by': confirmed_by_user,
                'approved_at': now,
                'is_active': True,
                'notes': f'Auto-assigned: sibling group #{group.id} ({group.name})',
            },
        )
        if not created and not sd.is_active:
            sd.is_active = True
            sd.approved_by = confirmed_by_user
            sd.approved_at = now
            sd.notes = f'Re-activated: sibling group #{group.id} ({group.name})'
            sd.save(update_fields=['is_active', 'approved_by', 'approved_at', 'notes'])

        logger.info(
            f"Sibling discount {'created' if created else 're-activated'} "
            f"for student {member.student.id} in group {group.id}"
        )
