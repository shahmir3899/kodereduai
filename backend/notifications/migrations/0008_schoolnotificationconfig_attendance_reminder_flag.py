from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0007_schoolnotificationconfig_new_notification_flags'),
    ]

    operations = [
        migrations.AddField(
            model_name='schoolnotificationconfig',
            name='class_teacher_attendance_reminder_enabled',
            field=models.BooleanField(
                default=True,
                help_text='Remind class teachers via in-app notification at 11:00 AM if student attendance is not yet marked',
            ),
        ),
    ]
