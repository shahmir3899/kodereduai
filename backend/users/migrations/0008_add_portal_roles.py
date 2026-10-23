from django.db import migrations, models


class Migration(migrations.Migration):
    """Choices only (no table change): STUDENT and PARENT as base roles."""

    dependencies = [
        ('users', '0007_rename_hr_manager_to_manager'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(choices=[('SUPER_ADMIN', 'Super Admin'), ('SCHOOL_ADMIN', 'School Admin'), ('PRINCIPAL', 'Principal'), ('MANAGER', 'Manager'), ('ACCOUNTANT', 'Accountant'), ('TEACHER', 'Teacher'), ('STAFF', 'Staff'), ('DRIVER', 'Driver'), ('STUDENT', 'Student'), ('PARENT', 'Parent')], default='STAFF', max_length=20),
        ),
    ]
