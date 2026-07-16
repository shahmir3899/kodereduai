from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):

    dependencies = [
        ('examinations', '0026_studenttermassessment_month_backfill'),
    ]

    operations = [
        migrations.AlterField(
            model_name='studenttermassessment',
            name='month',
            field=models.PositiveSmallIntegerField(
                help_text='Assessment month (1-12).',
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(12),
                ],
            ),
        ),
        migrations.AlterUniqueTogether(
            name='studenttermassessment',
            unique_together={('student', 'academic_year', 'month')},
        ),
        migrations.AddIndex(
            model_name='studenttermassessment',
            index=models.Index(fields=['school', 'academic_year', 'month'], name='exm_sta_sch_ay_m_idx'),
        ),
        migrations.AddIndex(
            model_name='studenttermassessment',
            index=models.Index(fields=['student', 'academic_year', 'month'], name='exm_sta_std_ay_m_idx'),
        ),
    ]
