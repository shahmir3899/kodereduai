# Generated manually for multi-page attendance register support

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('attendance', '0003_add_structured_table_and_feedback'),
    ]

    operations = [
        # Make image_url optional (for multi-page uploads that use AttendanceUploadImage)
        migrations.AlterField(
            model_name='attendanceupload',
            name='image_url',
            field=models.URLField(
                blank=True,
                max_length=500,
                help_text='URL of the uploaded register image (legacy single-image)'
            ),
        ),

        # Create AttendanceUploadImage model for multi-page support
        migrations.CreateModel(
            name='AttendanceUploadImage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('image_url', models.URLField(max_length=500, help_text='URL of this page image (Supabase)')),
                ('page_number', models.PositiveIntegerField(default=1, help_text='Page number in the register (1-indexed)')),
                ('ocr_raw_text', models.TextField(blank=True, help_text='Raw text extracted from this page')),
                ('structured_table_json', models.JSONField(blank=True, null=True, help_text='Structured table extracted from this page')),
                ('processing_status', models.CharField(
                    choices=[
                        ('PENDING', 'Pending'),
                        ('PROCESSING', 'Processing'),
                        ('COMPLETED', 'Completed'),
                        ('FAILED', 'Failed'),
                    ],
                    default='PENDING',
                    max_length=20
                )),
                ('error_message', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('upload', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='images',
                    to='attendance.attendanceupload'
                )),
            ],
            options={
                'verbose_name': 'Upload Image',
                'verbose_name_plural': 'Upload Images',
                'ordering': ['upload', 'page_number'],
                'unique_together': {('upload', 'page_number')},
            },
        ),
    ]
