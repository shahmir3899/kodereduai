# Generated manually on 2026-03-31

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('academic_sessions', '0008_alter_studentenrollment_options_and_more'),
        ('students', '0002_make_parent_phone_optional'),
    ]

    operations = [
        migrations.CreateModel(
            name='SchoolCalendarEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('description', models.TextField(blank=True)),
                ('entry_kind', models.CharField(choices=[('OFF_DAY', 'Off Day'), ('EVENT', 'Event')], max_length=20)),
                ('off_day_type', models.CharField(blank=True, choices=[('SUMMER_VACATION', 'Summer Vacation'), ('WINTER_VACATION', 'Winter Vacation'), ('RELIGIOUS_HOLIDAY', 'Religious Holiday'), ('NATIONAL_HOLIDAY', 'National Holiday'), ('EXAM_BREAK', 'Exam Break'), ('OTHER', 'Other')], default='', max_length=30)),
                ('scope', models.CharField(choices=[('SCHOOL', 'Whole School'), ('CLASS', 'Specific Classes')], default='SCHOOL', max_length=10)),
                ('start_date', models.DateField()),
                ('end_date', models.DateField()),
                ('color', models.CharField(blank=True, default='', max_length=20)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('academic_year', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='calendar_entries', to='academic_sessions.academicyear')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_calendar_entries', to=settings.AUTH_USER_MODEL)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='calendar_entries', to='schools.school')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_calendar_entries', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'School Calendar Entry',
                'verbose_name_plural': 'School Calendar Entries',
                'ordering': ['start_date', 'name', 'id'],
            },
        ),
        migrations.AddField(
            model_name='schoolcalendarentry',
            name='classes',
            field=models.ManyToManyField(blank=True, related_name='calendar_entries', to='students.class'),
        ),
        migrations.AddIndex(
            model_name='schoolcalendarentry',
            index=models.Index(fields=['school', 'academic_year', 'start_date', 'end_date'], name='academic_se_school__a89a6a_idx'),
        ),
        migrations.AddIndex(
            model_name='schoolcalendarentry',
            index=models.Index(fields=['school', 'entry_kind', 'scope', 'is_active'], name='academic_se_school__af95f0_idx'),
        ),
    ]
