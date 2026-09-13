from django.db import migrations, models


def forwards(apps, schema_editor):
    UserSchoolMembership = apps.get_model('schools', 'UserSchoolMembership')
    UserSchoolMembership.objects.filter(role='HR_MANAGER').update(role='MANAGER')


def backwards(apps, schema_editor):
    UserSchoolMembership = apps.get_model('schools', 'UserSchoolMembership')
    UserSchoolMembership.objects.filter(role='MANAGER').update(role='HR_MANAGER')


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0018_school_academic_risk_config_school_inventory_config'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userschoolmembership',
            name='role',
            field=models.CharField(choices=[('SCHOOL_ADMIN', 'School Admin'), ('PRINCIPAL', 'Principal'), ('MANAGER', 'Manager'), ('ACCOUNTANT', 'Accountant'), ('TEACHER', 'Teacher'), ('STAFF', 'Staff'), ('PARENT', 'Parent'), ('STUDENT', 'Student')], default='STAFF', max_length=20),
        ),
        migrations.RunPython(forwards, backwards),
    ]
