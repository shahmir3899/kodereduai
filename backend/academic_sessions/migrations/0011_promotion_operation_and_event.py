from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0010_rename_academic_se_school__a89a6a_idx_academic_se_school__7e8ecc_idx_and_more'),
        ('schools', '0014_school_exam_config'),
        ('students', '0012_alter_class_name'),
        ('users', '0004_alter_user_role'),
    ]

    operations = [
        migrations.CreateModel(
            name='PromotionOperation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('operation_type', models.CharField(choices=[('BULK_PROMOTE', 'Bulk Promote'), ('BULK_REVERSE', 'Bulk Reverse'), ('SINGLE_CORRECTION', 'Single Correction'), ('BULK_CORRECTION', 'Bulk Correction')], max_length=32)),
                ('status', models.CharField(choices=[('SUCCESS', 'Success'), ('PARTIAL', 'Partial'), ('FAILED', 'Failed')], default='SUCCESS', max_length=16)),
                ('total_students', models.PositiveIntegerField(default=0)),
                ('processed_count', models.PositiveIntegerField(default=0)),
                ('skipped_count', models.PositiveIntegerField(default=0)),
                ('error_count', models.PositiveIntegerField(default=0)),
                ('reason', models.TextField(blank=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('initiated_by', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='initiated_promotion_operations', to='users.user')),
                ('school', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='promotion_operations', to='schools.school')),
                ('source_academic_year', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_operations_as_source', to='academic_sessions.academicyear')),
                ('source_class', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_operations_as_source', to='students.class')),
                ('source_session_class', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_operations_as_source', to='academic_sessions.sessionclass')),
                ('target_academic_year', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_operations_as_target', to='academic_sessions.academicyear')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.CreateModel(
            name='PromotionEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(choices=[('PROMOTED', 'Promoted'), ('REPEATED', 'Repeated'), ('GRADUATED', 'Graduated'), ('REVERSED', 'Reversed'), ('SKIPPED', 'Skipped'), ('FAILED', 'Failed')], max_length=16)),
                ('old_status', models.CharField(blank=True, default='', max_length=20)),
                ('new_status', models.CharField(blank=True, default='', max_length=20)),
                ('old_roll_number', models.CharField(blank=True, default='', max_length=20)),
                ('new_roll_number', models.CharField(blank=True, default='', max_length=20)),
                ('reason', models.TextField(blank=True)),
                ('details', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_created', to='users.user')),
                ('operation', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='events', to='academic_sessions.promotionoperation')),
                ('school', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='promotion_events', to='schools.school')),
                ('source_academic_year', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_source', to='academic_sessions.academicyear')),
                ('source_class', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_source', to='students.class')),
                ('source_enrollment', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_source', to='academic_sessions.studentenrollment')),
                ('source_session_class', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_source', to='academic_sessions.sessionclass')),
                ('student', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='promotion_events', to='students.student')),
                ('target_academic_year', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_target', to='academic_sessions.academicyear')),
                ('target_class', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_target', to='students.class')),
                ('target_enrollment', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_target', to='academic_sessions.studentenrollment')),
                ('target_session_class', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='promotion_events_as_target', to='academic_sessions.sessionclass')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='promotionoperation',
            index=models.Index(fields=['school', 'created_at'], name='academic_se_school__2f37a4_idx'),
        ),
        migrations.AddIndex(
            model_name='promotionoperation',
            index=models.Index(fields=['school', 'operation_type', 'created_at'], name='academic_se_school__16bcb0_idx'),
        ),
        migrations.AddIndex(
            model_name='promotionoperation',
            index=models.Index(fields=['school', 'source_academic_year', 'target_academic_year'], name='academic_se_school__2f9fea_idx'),
        ),
        migrations.AddIndex(
            model_name='promotionevent',
            index=models.Index(fields=['school', 'created_at'], name='academic_se_school__f1331a_idx'),
        ),
        migrations.AddIndex(
            model_name='promotionevent',
            index=models.Index(fields=['school', 'event_type', 'created_at'], name='academic_se_school__8136b8_idx'),
        ),
        migrations.AddIndex(
            model_name='promotionevent',
            index=models.Index(fields=['school', 'source_academic_year', 'target_academic_year'], name='academic_se_school__4f6873_idx'),
        ),
        migrations.AddIndex(
            model_name='promotionevent',
            index=models.Index(fields=['school', 'student', 'created_at'], name='academic_se_school__eb141e_idx'),
        ),
    ]
