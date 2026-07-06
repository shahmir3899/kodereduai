from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_aijob'),
        ('schools', '0016_alter_school_module_entitlements'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='QueuedJob',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('callable_path', models.CharField(max_length=255)),
                ('task_args', models.JSONField(blank=True, default=list)),
                ('task_kwargs', models.JSONField(blank=True, default=dict)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('RUNNING', 'Running'), ('SUCCESS', 'Success'), ('FAILED', 'Failed'), ('CANCELLED', 'Cancelled')], default='PENDING', max_length=20)),
                ('priority', models.PositiveSmallIntegerField(default=100)),
                ('attempt_count', models.PositiveSmallIntegerField(default=0)),
                ('max_attempts', models.PositiveSmallIntegerField(default=3)),
                ('scheduled_for', models.DateTimeField(default=django.utils.timezone.now)),
                ('locked_at', models.DateTimeField(blank=True, null=True)),
                ('lock_expires_at', models.DateTimeField(blank=True, null=True)),
                ('last_heartbeat_at', models.DateTimeField(blank=True, null=True)),
                ('last_error', models.TextField(blank=True, default='')),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('background_task', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='queued_job', to='core.backgroundtask')),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='queued_jobs', to='schools.school')),
                ('triggered_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='queued_jobs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['priority', 'scheduled_for', 'id'],
            },
        ),
        migrations.AddIndex(
            model_name='queuedjob',
            index=models.Index(fields=['status', 'scheduled_for', 'priority'], name='core_queuedj_status_4f5080_idx'),
        ),
        migrations.AddIndex(
            model_name='queuedjob',
            index=models.Index(fields=['status', 'lock_expires_at'], name='core_queuedj_status_85a300_idx'),
        ),
        migrations.AddIndex(
            model_name='queuedjob',
            index=models.Index(fields=['school', 'status', '-created_at'], name='core_queuedj_school__f57bf2_idx'),
        ),
    ]
