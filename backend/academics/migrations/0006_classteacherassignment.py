from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0011_promotion_operation_and_event'),
        ('hr', '0001_initial'),
        ('students', '0012_alter_class_name'),
        ('academics', '0005_timetableslot_applicable_days'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClassTeacherAssignment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('academic_year', models.ForeignKey(blank=True, help_text='Academic year for this class-teacher assignment', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='class_teacher_assignments', to='academic_sessions.academicyear')),
                ('class_obj', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='class_teacher_assignments', to='students.class', verbose_name='Class')),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='class_teacher_assignments', to='schools.school')),
                ('teacher', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='class_teacher_assignments', to='hr.staffmember')),
            ],
            options={
                'ordering': ['class_obj__grade_level', 'class_obj__name', 'teacher__first_name'],
                'unique_together': {('school', 'academic_year', 'class_obj', 'teacher')},
            },
        ),
        migrations.AddIndex(
            model_name='classteacherassignment',
            index=models.Index(fields=['school', 'academic_year', 'is_active'], name='academics_cl_school__fa2af5_idx'),
        ),
        migrations.AddIndex(
            model_name='classteacherassignment',
            index=models.Index(fields=['teacher', 'academic_year', 'is_active'], name='academics_cl_teacher_feaaf8_idx'),
        ),
        migrations.AddIndex(
            model_name='classteacherassignment',
            index=models.Index(fields=['class_obj', 'academic_year', 'is_active'], name='academics_cl_class_o_63d658_idx'),
        ),
    ]
