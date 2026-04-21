from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0006_schoolnotificationconfig_transport_notification_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='schoolnotificationconfig',
            name='class_teacher_fee_reminder_enabled',
            field=models.BooleanField(
                default=True,
                help_text='Send consolidated fee pending reminders to class teachers on the 10th and 15th of each month',
            ),
        ),
        migrations.AddField(
            model_name='schoolnotificationconfig',
            name='lesson_plan_notification_enabled',
            field=models.BooleanField(
                default=True,
                help_text='Notify students in-app when a lesson plan is published for their class',
            ),
        ),
        migrations.AddField(
            model_name='schoolnotificationconfig',
            name='daily_report_enabled',
            field=models.BooleanField(
                default=True,
                help_text='Send a daily school report to admins and principal at 5 PM (attendance, lesson plans, fees, leave)',
            ),
        ),
    ]
