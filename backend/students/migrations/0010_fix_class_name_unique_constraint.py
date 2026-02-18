"""
Change unique_together on Class from (school, name) to (school, name, section).
Also strip section suffixes from existing class names so that the section is only
stored in the dedicated `section` field (e.g. "Class 1-A" → "Class 1").
"""
import re
from django.db import migrations


def strip_section_from_names(apps, schema_editor):
    """Remove section suffix (-A, -B, etc.) from class names when section field is set."""
    Class = apps.get_model('students', 'Class')
    for cls in Class.objects.filter(section__gt=''):
        # Strip trailing -<section> or <space><section> from name
        # e.g. "Class 1-A" → "Class 1", "Nursery-B" → "Nursery"
        pattern = rf'[\s\-]{re.escape(cls.section)}$'
        new_name = re.sub(pattern, '', cls.name).strip()
        if new_name and new_name != cls.name:
            cls.name = new_name
            cls.save(update_fields=['name'])


def restore_section_in_names(apps, schema_editor):
    """Reverse: append section back to name."""
    Class = apps.get_model('students', 'Class')
    for cls in Class.objects.filter(section__gt=''):
        if not cls.name.endswith(cls.section):
            cls.name = f'{cls.name}-{cls.section}'
            cls.save(update_fields=['name'])


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0009_session_scoped_roll_numbers'),
    ]

    operations = [
        # 1. Drop old unique_together (school, name)
        migrations.AlterUniqueTogether(
            name='class',
            unique_together=set(),
        ),
        # 2. Clean up names (strip section suffixes) before adding new constraint
        migrations.RunPython(strip_section_from_names, restore_section_in_names),
        # 3. Add new unique_together (school, name, section)
        migrations.AlterUniqueTogether(
            name='class',
            unique_together={('school', 'name', 'section')},
        ),
    ]
