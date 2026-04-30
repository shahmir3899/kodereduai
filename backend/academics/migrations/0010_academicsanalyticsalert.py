from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0009_alter_classsubject_options_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='AcademicsAnalyticsAlert',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('alert_code', models.CharField(max_length=80)),
                ('title', models.CharField(max_length=255)),
                ('severity', models.CharField(choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High')], default='medium', max_length=10)),
                ('status', models.CharField(choices=[('new', 'New'), ('acknowledged', 'Acknowledged'), ('resolved', 'Resolved')], default='new', max_length=20)),
                ('rationale', models.TextField(blank=True)),
                ('suggested_action', models.TextField(blank=True)),
                ('metric_key', models.CharField(blank=True, max_length=120)),
                ('metric_value', models.FloatField(blank=True, null=True)),
                ('context', models.JSONField(blank=True, default=dict)),
                ('first_seen_at', models.DateTimeField(auto_now_add=True)),
                ('last_seen_at', models.DateTimeField(auto_now_add=True)),
                ('acknowledged_at', models.DateTimeField(blank=True, null=True)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='academics_analytics_alerts', to='schools.school')),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),
        migrations.AddIndex(
            model_name='academicsanalyticsalert',
            index=models.Index(fields=['school', 'status', 'severity'], name='academics_a_school__d365d7_idx'),
        ),
        migrations.AddIndex(
            model_name='academicsanalyticsalert',
            index=models.Index(fields=['school', 'alert_code'], name='academics_a_school__f90aaf_idx'),
        ),
    ]
