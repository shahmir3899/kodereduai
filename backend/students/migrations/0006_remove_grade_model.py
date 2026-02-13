"""
Remove the Grade model entirely. Keep Class + Section as the only structure.
grade_level on Class provides sorting/grouping (replaces Grade.numeric_level).

This migration must run AFTER finance and admissions have removed their
FK references to Grade.
"""

from django.db import migrations, models


def copy_grade_level_from_grade(apps, schema_editor):
    """
    Ensure every Class has grade_level populated from its Grade FK.
    Most classes already have grade_level set, but this is a safety net.
    Also sets grade_level=0 for any classes with NULL grade_level.
    """
    Class = apps.get_model('students', 'Class')

    # Copy from Grade FK where available
    for cls in Class.objects.select_related('grade').filter(
        grade__isnull=False,
        grade_level__isnull=True,
    ):
        cls.grade_level = cls.grade.numeric_level
        cls.save(update_fields=['grade_level'])

    # Set remaining NULLs to 0
    Class.objects.filter(grade_level__isnull=True).update(grade_level=0)


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0005_studentinvite_studentprofile'),
        # Must run after finance/admissions remove their Grade FKs
        ('finance', '0010_replace_target_grade_with_grade_level'),
        ('admissions', '0002_replace_grade_references'),
    ]

    operations = [
        # 1. Copy grade data before removing anything
        migrations.RunPython(
            copy_grade_level_from_grade,
            reverse_code=migrations.RunPython.noop,
        ),

        # 2. Remove old constraint that references grade FK
        migrations.RemoveConstraint(
            model_name='class',
            name='unique_grade_section_per_school',
        ),

        # 3. Remove the grade FK from Class
        migrations.RemoveField(
            model_name='class',
            name='grade',
        ),

        # 4. Make grade_level non-nullable with default=0
        migrations.AlterField(
            model_name='class',
            name='grade_level',
            field=models.IntegerField(
                default=0,
                help_text='Numeric grade level for sorting/grouping (e.g., 0=Playgroup, 3=Class 1, 12=Class 10)',
            ),
        ),

        # 5. Add new unique constraint on (school, grade_level, section) when section is non-empty
        migrations.AddConstraint(
            model_name='class',
            constraint=models.UniqueConstraint(
                fields=['school', 'grade_level', 'section'],
                condition=models.Q(section__gt=''),
                name='unique_level_section_per_school',
            ),
        ),

        # 6. Update model options (ordering)
        migrations.AlterModelOptions(
            name='class',
            options={
                'ordering': ['grade_level', 'section', 'name'],
                'verbose_name': 'Class',
                'verbose_name_plural': 'Classes',
            },
        ),

        # 7. Delete Grade model (safe now — no FKs point to it)
        migrations.DeleteModel(
            name='Grade',
        ),
    ]
