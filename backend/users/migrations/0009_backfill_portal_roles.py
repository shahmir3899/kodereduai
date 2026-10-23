from django.db import migrations

from users.portal_roles import backfill_portal_roles, restore_portal_roles


def forwards(apps, schema_editor):
    result = backfill_portal_roles(apps.get_model('users', 'User'), apps.get_model('schools', 'UserSchoolMembership'))
    if result['review']:
        # Not converted on purpose (a staff member who is also a parent, or both profiles): a person decides.
        print(f"\n  portal role backfill: {result['converted']} converted, "
              f"{len(result['review'])} left for review (user ids {result['review']})")


def backwards(apps, schema_editor):
    restore_portal_roles(apps.get_model('users', 'User'))


class Migration(migrations.Migration):
    """Student and parent accounts were saved as STAFF; give existing ones their own base role.

    Conservative and reversible: see users/portal_roles.py.
    """

    dependencies = [
        ('users', '0008_add_portal_roles'),
        ('schools', '0019_rename_hr_manager_to_manager'),
        ('students', '0017_student_hard_delete_guard'),
        ('parents', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
