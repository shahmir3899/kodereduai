from django.db import migrations


def attach_overrides_to_last_exam(apps, schema_editor):
    """Rows used to be keyed by term. A card is now built around its last exam, so each
    row moves to the last exam of its term (or of the year, for "all terms" rows) for the
    student's class. Rows with nothing to attach to keep exam=NULL and are only reported."""
    Override = apps.get_model('examinations', 'ReportCardOverride')
    Exam = apps.get_model('examinations', 'Exam')
    Enrollment = apps.get_model('academic_sessions', 'StudentEnrollment')

    unmapped = []
    taken = set()
    for row in Override.objects.all().order_by('id'):
        enrollment = Enrollment.objects.filter(
            student_id=row.student_id, academic_year_id=row.academic_year_id,
        ).order_by('-created_at').first()
        exam = None
        if enrollment:
            qs = Exam.objects.filter(
                school_id=row.school_id, class_obj_id=enrollment.class_obj_id,
                academic_year_id=row.academic_year_id, is_active=True,
            )
            if row.term_id:
                qs = qs.filter(term_id=row.term_id)
            exam = qs.order_by('-end_date', '-start_date', '-id').first()
        if exam is None or (row.student_id, exam.id) in taken:
            unmapped.append(row.id)
            continue
        taken.add((row.student_id, exam.id))
        row.exam_id = exam.id
        row.save(update_fields=['exam'])
    if unmapped:
        print("ReportCardOverride rows left without an exam (kept, not deleted): %s" % unmapped)


class Migration(migrations.Migration):

    dependencies = [
        ('examinations', '0036_report_card_override_per_exam'),
        ('academic_sessions', '0015_studentrisksnapshot'),
    ]

    operations = [
        migrations.RunPython(attach_overrides_to_last_exam, migrations.RunPython.noop),
    ]
