"""Accountant stops being a role: it becomes MANAGER + can_manage_finance.

Also adds DRIVER to the membership role choices (it existed only on User.role, so a driver
had no per-school role).
"""
from django.db import migrations, models


def accountants_to_managers(apps, schema_editor):
    Membership = apps.get_model('schools', 'UserSchoolMembership')
    Membership.objects.filter(role='ACCOUNTANT').update(role='MANAGER', can_manage_finance=True)


def managers_back_to_accountants(apps, schema_editor):
    Membership = apps.get_model('schools', 'UserSchoolMembership')
    Membership.objects.filter(role='MANAGER', can_manage_finance=True).update(role='ACCOUNTANT')


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0021_school_listed_in_app'),
    ]

    operations = [
        migrations.AddField(
            model_name='userschoolmembership',
            name='can_manage_finance',
            field=models.BooleanField(
                default=False,
                help_text='Managers only: grants finance and fee access',
            ),
        ),
        # The data move runs while 'ACCOUNTANT' is still a valid value, then the choices change.
        migrations.RunPython(accountants_to_managers, managers_back_to_accountants),
        migrations.AlterField(
            model_name='userschoolmembership',
            name='role',
            field=models.CharField(
                choices=[
                    ('SCHOOL_ADMIN', 'School Admin'), ('PRINCIPAL', 'Principal'), ('MANAGER', 'Manager'),
                    ('TEACHER', 'Teacher'), ('STAFF', 'Staff'), ('DRIVER', 'Driver'),
                    ('PARENT', 'Parent'), ('STUDENT', 'Student'),
                ],
                default='STAFF', max_length=20,
            ),
        ),
    ]
