from django.db import migrations, models


class Migration(migrations.Migration):
    """Paper Builder v2 Phase 6b: worksheets keep the same block list as papers. New column only."""

    dependencies = [
        ('examinations', '0042_studentmark_entered_by'),
    ]

    operations = [
        migrations.AddField(
            model_name='worksheet',
            name='document',
            field=models.JSONField(blank=True, default=dict, help_text='Block list for the block-based builder; empty for old-style worksheets.'),
        ),
    ]
