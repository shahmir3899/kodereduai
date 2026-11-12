"""User.role ACCOUNTANT becomes MANAGER (the finance capability lives on the school membership,
moved by schools 0022)."""
from django.db import migrations, models


def accountants_to_managers(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='ACCOUNTANT').update(role='MANAGER')


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0009_backfill_portal_roles'),
        ('schools', '0022_accountant_to_manager_finance_flag'),
    ]

    operations = [
        migrations.RunPython(accountants_to_managers, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(
                choices=[
                    ('SUPER_ADMIN', 'Super Admin'), ('SCHOOL_ADMIN', 'School Admin'), ('PRINCIPAL', 'Principal'),
                    ('MANAGER', 'Manager'), ('TEACHER', 'Teacher'), ('STAFF', 'Staff'), ('DRIVER', 'Driver'),
                    ('STUDENT', 'Student'), ('PARENT', 'Parent'),
                ],
                default='STAFF', max_length=20,
            ),
        ),
    ]
