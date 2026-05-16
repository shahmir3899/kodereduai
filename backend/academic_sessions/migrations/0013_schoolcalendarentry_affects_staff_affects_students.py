from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0012_rename_academic_se_school__f1331a_idx_academic_se_school__3d73df_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='schoolcalendarentry',
            name='affects_students',
            field=models.BooleanField(
                default=True,
                help_text='If True, this OFF day applies to student attendance (students get NA).',
            ),
        ),
        migrations.AddField(
            model_name='schoolcalendarentry',
            name='affects_staff',
            field=models.BooleanField(
                default=True,
                help_text='If True, this OFF day applies to staff attendance (staff auto-marked ON_LEAVE).',
            ),
        ),
    ]
