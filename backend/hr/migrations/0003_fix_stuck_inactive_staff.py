from django.db import migrations


def fix_stuck_inactive_staff(apps, schema_editor):
    """
    Backfill staff whose is_active flag drifted out of sync with
    employment_status before the model-level sync was added (e.g. someone
    was deactivated, then "reactivated" via the employment_status dropdown,
    which used to leave is_active stuck at False).
    """
    StaffMember = apps.get_model('hr', 'StaffMember')
    StaffMember.objects.filter(
        is_active=False, employment_status='ACTIVE',
    ).update(is_active=True)
    StaffMember.objects.filter(
        is_active=True, employment_status__in=['TERMINATED', 'RESIGNED'],
    ).update(is_active=False)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0002_staff_employment_status_retired'),
    ]

    operations = [
        migrations.RunPython(fix_stuck_inactive_staff, noop_reverse),
    ]
