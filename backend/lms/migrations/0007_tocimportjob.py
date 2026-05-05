from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('lms', '0006_subtopic_and_lessonplan_subtopics'),
        ('schools', '0001_initial'),
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='TOCImportJob',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('status', models.CharField(choices=[('QUEUED', 'Queued'), ('PROCESSING', 'Processing'), ('SUCCEEDED', 'Succeeded'), ('FAILED', 'Failed'), ('TIMED_OUT', 'Timed Out')], default='QUEUED', max_length=20)),
                ('image_file_name', models.CharField(blank=True, max_length=255)),
                ('image_content_type', models.CharField(blank=True, max_length=100)),
                ('image_size_bytes', models.PositiveIntegerField(default=0)),
                ('image_payload_b64', models.TextField(blank=True, help_text='Base64-encoded image payload for worker processing')),
                ('result_payload', models.JSONField(blank=True, default=dict)),
                ('error_message', models.TextField(blank=True)),
                ('attempt_count', models.PositiveSmallIntegerField(default=0)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('book', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='toc_import_jobs', to='lms.book')),
                ('requested_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='toc_import_jobs', to='users.user')),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='toc_import_jobs', to='schools.school')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='tocimportjob',
            index=models.Index(fields=['school', 'status'], name='lms_tocimpo_school__a23157_idx'),
        ),
        migrations.AddIndex(
            model_name='tocimportjob',
            index=models.Index(fields=['book', 'created_at'], name='lms_tocimpo_book_id_7ae610_idx'),
        ),
        migrations.AddIndex(
            model_name='tocimportjob',
            index=models.Index(fields=['created_at'], name='lms_tocimpo_created_16b7a4_idx'),
        ),
    ]
