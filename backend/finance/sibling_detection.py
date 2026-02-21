"""
Sibling detection engine.

Scores pairs of students based on shared parent/guardian information.
Creates SiblingSuggestion records for matches above the confidence threshold.
"""
import logging
from django.db.models import Q

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 40
HIGH_CONFIDENCE_THRESHOLD = 70

SIGNAL_WEIGHTS = {
    'parent_phone': 40,
    'guardian_phone': 30,
    'parent_name': 25,
    'guardian_name': 15,
    'parent_child_link': 50,
}


def normalize_phone(phone):
    """Strip whitespace, dashes, leading +/0 for comparison."""
    if not phone:
        return ''
    return phone.strip().replace('-', '').replace(' ', '').lstrip('+').lstrip('0')


def normalize_name(name):
    """Lowercase, strip, collapse whitespace."""
    if not name:
        return ''
    return ' '.join(name.lower().strip().split())


def compute_sibling_score(student_a, student_b):
    """
    Compute a confidence score (0-100) that two students are siblings.
    Returns (score, match_signals_dict).
    """
    score = 0
    signals = {}

    # Phone matching
    a_parent = normalize_phone(student_a.parent_phone)
    b_parent = normalize_phone(student_b.parent_phone)
    a_guardian = normalize_phone(student_a.guardian_phone)
    b_guardian = normalize_phone(student_b.guardian_phone)

    if a_parent and (a_parent == b_parent or a_parent == b_guardian):
        score += SIGNAL_WEIGHTS['parent_phone']
        signals['parent_phone'] = True
    elif a_guardian and (a_guardian == b_parent or a_guardian == b_guardian):
        score += SIGNAL_WEIGHTS['guardian_phone']
        signals['guardian_phone'] = True

    # Name matching
    a_parent_name = normalize_name(student_a.parent_name)
    b_parent_name = normalize_name(student_b.parent_name)
    if a_parent_name and b_parent_name and a_parent_name == b_parent_name:
        score += SIGNAL_WEIGHTS['parent_name']
        signals['parent_name'] = True

    a_guardian_name = normalize_name(student_a.guardian_name)
    b_guardian_name = normalize_name(student_b.guardian_name)
    if a_guardian_name and b_guardian_name and a_guardian_name == b_guardian_name:
        score += SIGNAL_WEIGHTS['guardian_name']
        signals['guardian_name'] = True

    # ParentChild link matching
    from parents.models import ParentChild
    a_parent_ids = set(
        ParentChild.objects.filter(student=student_a)
        .values_list('parent_id', flat=True)
    )
    if a_parent_ids:
        shared = ParentChild.objects.filter(
            student=student_b, parent_id__in=a_parent_ids
        ).exists()
        if shared:
            score += SIGNAL_WEIGHTS['parent_child_link']
            signals['parent_child_link'] = True

    score = min(score, 100)
    return score, signals


def detect_siblings_for_student(student):
    """
    Find potential siblings for a given student within the same school.
    Creates SiblingSuggestion records for matches above threshold.
    Returns count of suggestions created.
    """
    from finance.models import SiblingSuggestion, SiblingGroupMember
    from students.models import Student

    school_id = student.school_id

    # Skip if student has no identifiable parent info
    has_phone = bool(
        (student.parent_phone and student.parent_phone.strip())
        or (student.guardian_phone and student.guardian_phone.strip())
    )
    has_name = bool(
        (student.parent_name and student.parent_name.strip())
        or (student.guardian_name and student.guardian_name.strip())
    )
    if not has_phone and not has_name:
        return 0

    # Build candidate query: students in same school with overlapping phone OR name
    phone_q = Q()
    if student.parent_phone and student.parent_phone.strip():
        phone_q |= Q(parent_phone=student.parent_phone.strip())
        phone_q |= Q(guardian_phone=student.parent_phone.strip())
    if student.guardian_phone and student.guardian_phone.strip():
        phone_q |= Q(parent_phone=student.guardian_phone.strip())
        phone_q |= Q(guardian_phone=student.guardian_phone.strip())

    name_q = Q()
    if student.parent_name and student.parent_name.strip():
        name_q |= Q(parent_name__iexact=student.parent_name.strip())
    if student.guardian_name and student.guardian_name.strip():
        name_q |= Q(guardian_name__iexact=student.guardian_name.strip())

    combined_q = Q()
    if phone_q:
        combined_q |= phone_q
    if name_q:
        combined_q |= name_q

    if not combined_q:
        return 0

    candidates = Student.objects.filter(
        combined_q,
        school_id=school_id,
        is_active=True,
    ).exclude(id=student.id).select_related('class_obj')

    created_count = 0
    for candidate in candidates:
        score, signals = compute_sibling_score(student, candidate)
        if score < CONFIDENCE_THRESHOLD:
            continue

        # Consistent ordering: lower id = student_a
        a_id, b_id = sorted([student.id, candidate.id])

        # Skip if already in the same confirmed group
        a_group = SiblingGroupMember.objects.filter(
            student_id=a_id, group__is_active=True
        ).values_list('group_id', flat=True).first()
        b_group = SiblingGroupMember.objects.filter(
            student_id=b_id, group__is_active=True
        ).values_list('group_id', flat=True).first()
        if a_group and a_group == b_group:
            continue

        # Skip if a PENDING or CONFIRMED suggestion already exists
        existing = SiblingSuggestion.objects.filter(
            school_id=school_id,
            student_a_id=a_id,
            student_b_id=b_id,
            status__in=['PENDING', 'CONFIRMED'],
        ).exists()
        if existing:
            continue

        SiblingSuggestion.objects.create(
            school_id=school_id,
            student_a_id=a_id,
            student_b_id=b_id,
            confidence_score=score,
            match_signals=signals,
            status='PENDING',
        )
        created_count += 1
        logger.info(
            f"Sibling suggestion created: {a_id} <-> {b_id} "
            f"(score={score}, signals={signals})"
        )

    return created_count
