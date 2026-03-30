from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('academic_sessions', '0005_sessionclass'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='sessionclass',
            name='unique_session_class_master_link_per_year',
        ),
    ]
