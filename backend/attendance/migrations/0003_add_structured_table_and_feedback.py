# Generated manually for new pipeline support

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('attendance', '0002_initial'),
        ('schools', '0002_add_register_config'),
        ('students', '0002_make_parent_phone_optional'),
    ]

    operations = [
        # Add structured_table_json field to AttendanceUpload
        migrations.AddField(
            model_name='attendanceupload',
            name='structured_table_json',
            field=models.JSONField(
                blank=True,
                null=True,
                help_text='Structured table extracted from OCR: {students: [], date_columns: {}}'
            ),
        ),

        # Create AttendanceFeedback model for learning loop
        migrations.CreateModel(
            name='AttendanceFeedback',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('correction_type', models.CharField(
                    choices=[
                        ('false_positive', 'AI marked absent but human marked present'),
                        ('false_negative', 'AI marked present but human marked absent'),
                        ('roll_mismatch', 'AI matched wrong student by roll'),
                        ('name_mismatch', 'AI matched wrong student by name'),
                        ('mark_misread', 'OCR read mark incorrectly'),
                    ],
                    max_length=20
                )),
                ('ai_prediction', models.CharField(help_text='What AI predicted (PRESENT/ABSENT)', max_length=20)),
                ('human_correction', models.CharField(help_text='What human confirmed (PRESENT/ABSENT)', max_length=20)),
                ('raw_mark', models.CharField(blank=True, help_text='The raw mark text that was misinterpreted', max_length=20)),
                ('ocr_confidence', models.FloatField(default=0, help_text='OCR confidence for this cell (0-1)')),
                ('match_type', models.CharField(blank=True, help_text='How the student was matched (roll_exact, name_fuzzy_85, etc.)', max_length=50)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('school', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='attendance_feedbacks',
                    to='schools.school'
                )),
                ('upload', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='feedbacks',
                    to='attendance.attendanceupload'
                )),
                ('student', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='attendance_feedbacks',
                    to='students.student'
                )),
            ],
            options={
                'verbose_name': 'Attendance Feedback',
                'verbose_name_plural': 'Attendance Feedbacks',
                'ordering': ['-created_at'],
            },
        ),

        # Add indexes for better query performance
        migrations.AddIndex(
            model_name='attendancefeedback',
            index=models.Index(fields=['school', 'created_at'], name='attendance__school__idx'),
        ),
        migrations.AddIndex(
            model_name='attendancefeedback',
            index=models.Index(fields=['correction_type'], name='attendance__correct_idx'),
        ),
    ]
