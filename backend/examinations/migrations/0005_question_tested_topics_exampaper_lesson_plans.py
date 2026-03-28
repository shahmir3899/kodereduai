# Generated migration for curriculum-paper connections

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('lms', '0003_add_curriculum_models'),
        ('examinations', '0004_exampaper_paperupload_paperfeedback_question_and_more'),
    ]

    operations = [
        # Add M2M: Question ↔ Topic
        migrations.AddField(
            model_name='question',
            name='tested_topics',
            field=models.ManyToManyField(
                'lms.Topic',
                blank=True,
                related_name='test_questions',
                help_text='Curriculum topics this question tests'
            ),
        ),
        
        # Add M2M: ExamPaper ↔ LessonPlan
        migrations.AddField(
            model_name='exampaper',
            name='lesson_plans',
            field=models.ManyToManyField(
                'lms.LessonPlan',
                blank=True,
                related_name='exam_papers',
                help_text='Lesson plans whose content is tested in this paper'
            ),
        ),
        
        # Add index for topic filtering
        migrations.AddIndex(
            model_name='question',
            index=models.Index(
                fields=['school', 'is_active'],
                name='exam_q_school_active_idx'
            ),
        ),
    ]
