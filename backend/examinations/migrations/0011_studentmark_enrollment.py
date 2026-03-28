# Generated manually to add durable enrollment linkage for StudentMark.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0004_alter_studentenrollment_status'),
        ('examinations', '0010_fix_studentmark_cascade'),
    ]

    operations = [
        migrations.AddField(
            model_name='studentmark',
            name='enrollment',
            field=models.ForeignKey(
                blank=True,
                help_text='Enrollment snapshot used for historical/session report accuracy',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='student_marks',
                to='academic_sessions.studentenrollment',
            ),
        ),
        migrations.AddIndex(
            model_name='studentmark',
            index=models.Index(fields=['school', 'enrollment'], name='exm_sm_sch_enr_idx'),
        ),
    ]
