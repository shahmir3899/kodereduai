"""
Replace Grade references in admissions models:
- AdmissionSession.grades_open M2M → grade_levels_open JSONField
- AdmissionEnquiry.applying_for_grade FK → applying_for_grade_level IntegerField
"""

from django.db import migrations, models


def copy_admission_grade_data(apps, schema_editor):
    """Copy Grade FK/M2M data to grade_level integers."""
    AdmissionSession = apps.get_model('admissions', 'AdmissionSession')
    AdmissionEnquiry = apps.get_model('admissions', 'AdmissionEnquiry')

    # Convert grades_open M2M → grade_levels_open JSON array
    for session in AdmissionSession.objects.prefetch_related('grades_open').all():
        levels = list(
            session.grades_open.values_list('numeric_level', flat=True)
        )
        if levels:
            session.grade_levels_open = sorted(levels)
            session.save(update_fields=['grade_levels_open'])

    # Convert applying_for_grade FK → applying_for_grade_level int
    for enquiry in AdmissionEnquiry.objects.select_related('applying_for_grade').filter(
        applying_for_grade__isnull=False
    ):
        enquiry.applying_for_grade_level = enquiry.applying_for_grade.numeric_level
        enquiry.save(update_fields=['applying_for_grade_level'])


class Migration(migrations.Migration):

    dependencies = [
        ('admissions', '0001_initial'),
        ('students', '0005_studentinvite_studentprofile'),
    ]

    operations = [
        # 1. Add new fields alongside old ones
        migrations.AddField(
            model_name='admissionsession',
            name='grade_levels_open',
            field=models.JSONField(
                default=list,
                blank=True,
                help_text='List of grade level integers open for admission, e.g. [0, 1, 2, 3]',
            ),
        ),
        migrations.AddField(
            model_name='admissionenquiry',
            name='applying_for_grade_level',
            field=models.IntegerField(
                null=True,
                blank=True,
                help_text='Grade level the child is applying for (e.g., 0=Playgroup, 3=Class 1)',
            ),
        ),

        # 2. Copy data from old to new
        migrations.RunPython(
            copy_admission_grade_data,
            reverse_code=migrations.RunPython.noop,
        ),

        # 3. Remove old fields
        migrations.RemoveField(
            model_name='admissionsession',
            name='grades_open',
        ),
        migrations.RemoveField(
            model_name='admissionenquiry',
            name='applying_for_grade',
        ),
    ]
