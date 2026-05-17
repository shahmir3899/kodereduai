from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('examinations', '0015_allow_multiple_standalone_tests'),
    ]

    operations = [
        migrations.AddField(
            model_name='paperquestion',
            name='question_snapshot',
            field=models.JSONField(blank=True, default=dict, help_text='Frozen copy of the question at the time it was attached or saved into the paper.'),
        ),
    ]