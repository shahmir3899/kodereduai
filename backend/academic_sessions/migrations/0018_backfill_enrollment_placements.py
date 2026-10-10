from django.db import migrations

BATCH = 500


def backfill(apps, schema_editor):
    """One open placement per enrollment that has none, covering the whole year, so the
    dated history starts out identical to what the enrollment already says."""
    Enrollment = apps.get_model('academic_sessions', 'StudentEnrollment')
    Placement = apps.get_model('academic_sessions', 'EnrollmentPlacement')

    have = set(Placement.objects.values_list('enrollment_id', flat=True))
    rows = []
    for enrollment in Enrollment.objects.select_related('academic_year').iterator(chunk_size=BATCH):
        if enrollment.id in have:
            continue
        rows.append(Placement(
            school_id=enrollment.school_id, enrollment_id=enrollment.id, student_id=enrollment.student_id,
            academic_year_id=enrollment.academic_year_id, session_class_id=enrollment.session_class_id,
            class_obj_id=enrollment.class_obj_id, roll_number=enrollment.roll_number,
            start_date=enrollment.academic_year.start_date, end_date=None,
            reason='Initial placement (backfill)',
        ))
        if len(rows) >= BATCH:
            Placement.objects.bulk_create(rows)
            rows = []
    if rows:
        Placement.objects.bulk_create(rows)


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0017_roll_unique_active_only_and_placements'),
    ]

    operations = [
        # Reversing keeps the rows: they are harmless without the code that reads them,
        # and dropping the table in 0017's reverse removes them anyway.
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
