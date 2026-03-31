from django.db import migrations, models


def populate_session_class_links(apps, schema_editor):
    StudentEnrollment = apps.get_model('academic_sessions', 'StudentEnrollment')
    SessionClass = apps.get_model('academic_sessions', 'SessionClass')

    enrollments = StudentEnrollment.objects.filter(session_class__isnull=True).exclude(class_obj__isnull=True)

    for enrollment in enrollments.iterator():
        matches = list(SessionClass.objects.filter(
            school_id=enrollment.school_id,
            academic_year_id=enrollment.academic_year_id,
            class_obj_id=enrollment.class_obj_id,
        ).values_list('id', flat=True)[:2])
        if len(matches) == 1:
            StudentEnrollment.objects.filter(pk=enrollment.pk).update(session_class_id=matches[0])


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0006_remove_sessionclass_master_link_unique'),
    ]

    operations = [
        migrations.AddField(
            model_name='studentenrollment',
            name='session_class',
            field=models.ForeignKey(blank=True, help_text='Year-specific class placement for this enrollment.', null=True, on_delete=models.SET_NULL, related_name='enrollments', to='academic_sessions.sessionclass'),
        ),
        migrations.RunPython(populate_session_class_links, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name='studentenrollment',
            name='unique_roll_per_session_class',
        ),
        migrations.AddIndex(
            model_name='studentenrollment',
            index=models.Index(fields=['school', 'academic_year', 'session_class'], name='academic_se_school__e5264f_idx'),
        ),
        migrations.AddConstraint(
            model_name='studentenrollment',
            constraint=models.UniqueConstraint(condition=models.Q(session_class__isnull=False), fields=('school', 'academic_year', 'session_class', 'roll_number'), name='unique_roll_per_session_class_enrollment'),
        ),
        migrations.AddConstraint(
            model_name='studentenrollment',
            constraint=models.UniqueConstraint(condition=models.Q(session_class__isnull=True), fields=('school', 'academic_year', 'class_obj', 'roll_number'), name='unique_roll_per_legacy_class_enrollment'),
        ),
    ]