# Generated manually for curriculum sub-topics and lesson plan links.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('lms', '0005_homework_diary_types'),
    ]

    operations = [
        migrations.CreateModel(
            name='SubTopic',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=300)),
                ('subtopic_number', models.PositiveIntegerField(help_text='Ordering within the parent topic (1, 2, 3…)')),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('topic', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='subtopics', to='lms.topic')),
            ],
            options={
                'verbose_name': 'Sub-topic',
                'verbose_name_plural': 'Sub-topics',
                'ordering': ['subtopic_number'],
                'unique_together': {('topic', 'subtopic_number')},
            },
        ),
        migrations.AddIndex(
            model_name='subtopic',
            index=models.Index(fields=['topic', 'subtopic_number'], name='lms_subtopic_topic_sn_idx'),
        ),
        migrations.AddField(
            model_name='lessonplan',
            name='planned_subtopics',
            field=models.ManyToManyField(
                blank=True,
                help_text='Optional finer curriculum units linked to this lesson',
                related_name='lesson_plans',
                to='lms.subtopic',
            ),
        ),
    ]
