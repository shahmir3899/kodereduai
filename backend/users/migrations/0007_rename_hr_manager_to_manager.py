from django.db import migrations, models


def forwards(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='HR_MANAGER').update(role='MANAGER')


def backwards(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='MANAGER').update(role='HR_MANAGER')


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0006_add_driver_role'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(choices=[('SUPER_ADMIN', 'Super Admin'), ('SCHOOL_ADMIN', 'School Admin'), ('PRINCIPAL', 'Principal'), ('MANAGER', 'Manager'), ('ACCOUNTANT', 'Accountant'), ('TEACHER', 'Teacher'), ('STAFF', 'Staff'), ('DRIVER', 'Driver')], default='STAFF', max_length=20),
        ),
        migrations.RunPython(forwards, backwards),
    ]
