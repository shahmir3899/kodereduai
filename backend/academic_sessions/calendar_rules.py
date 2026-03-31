from datetime import timedelta

from django.db.models import Q

from .models import SchoolCalendarEntry


def _normalize_class_ids(class_id=None, class_ids=None):
    ids = set()
    if class_id:
        ids.add(int(class_id))
    if class_ids:
        for value in class_ids:
            if value:
                ids.add(int(value))
    return ids


def off_day_types_for_date(school_id, target_date, class_id=None, class_ids=None):
    """Return off-day type labels for a date including derived Sunday."""
    labels = []
    if target_date.weekday() == 6:
        labels.append('SUNDAY')

    selected_class_ids = _normalize_class_ids(class_id=class_id, class_ids=class_ids)
    entries = SchoolCalendarEntry.objects.filter(
        school_id=school_id,
        is_active=True,
        entry_kind=SchoolCalendarEntry.EntryKind.OFF_DAY,
        start_date__lte=target_date,
        end_date__gte=target_date,
    )

    if selected_class_ids:
        entries = entries.filter(
            Q(scope=SchoolCalendarEntry.Scope.SCHOOL)
            | Q(scope=SchoolCalendarEntry.Scope.CLASS, classes__id__in=selected_class_ids)
        ).distinct()

    entries = entries.prefetch_related('classes')

    for entry in entries:
        if entry.scope == SchoolCalendarEntry.Scope.SCHOOL:
            if entry.off_day_type:
                labels.append(entry.off_day_type)
            continue

        if not selected_class_ids:
            continue

        entry_class_ids = {class_obj.id for class_obj in entry.classes.all()}
        if entry_class_ids.intersection(selected_class_ids):
            if entry.off_day_type:
                labels.append(entry.off_day_type)

    return sorted(set(labels))


def is_off_day_for_date(school_id, target_date, class_id=None, class_ids=None):
    return len(off_day_types_for_date(
        school_id=school_id,
        target_date=target_date,
        class_id=class_id,
        class_ids=class_ids,
    )) > 0


def build_off_day_date_set(school_id, date_from, date_to, class_id=None, class_ids=None):
    """Return a set of dates marked as OFF in the given date window."""
    off_dates = set()
    cursor = date_from
    while cursor <= date_to:
        if is_off_day_for_date(
            school_id=school_id,
            target_date=cursor,
            class_id=class_id,
            class_ids=class_ids,
        ):
            off_dates.add(cursor)
        cursor += timedelta(days=1)
    return off_dates
