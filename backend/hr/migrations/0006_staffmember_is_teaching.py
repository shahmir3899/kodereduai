import re

from django.db import migrations, models

# Same words the HR directory used to match on the frontend, so the first backfill keeps
# today's teaching/non-teaching counts.
TEACHING_TITLE = re.compile(r'(teacher|lecturer|instructor|professor|tutor|faculty)', re.I)


def backfill_is_teaching(apps, schema_editor):
    Staff = apps.get_model('hr', 'StaffMember')
    for staff in Staff.objects.select_related('designation', 'user').iterator(chunk_size=500):
        title = staff.designation.name if staff.designation_id else ''
        by_role = bool(staff.user_id and staff.user.role == 'TEACHER')
        if by_role or TEACHING_TITLE.search(title or ''):
            staff.is_teaching = True
            staff.save(update_fields=['is_teaching'])


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0005_document_scan_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='staffmember',
            name='is_teaching',
            field=models.BooleanField(
                default=False,
                help_text='Teaching staff: appears in teacher pickers and the teaching headcount',
            ),
        ),
        migrations.RunPython(backfill_is_teaching, migrations.RunPython.noop),
    ]
