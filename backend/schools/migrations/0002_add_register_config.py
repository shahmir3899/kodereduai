# Generated manually for register format configuration

from django.db import migrations, models
import schools.models


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='school',
            name='mark_mappings',
            field=models.JSONField(
                default=schools.models.default_mark_mappings,
                help_text='Maps symbols to status: {"PRESENT": ["P", "✓"], "ABSENT": ["A", "✗"], "default": "ABSENT"}'
            ),
        ),
        migrations.AddField(
            model_name='school',
            name='register_config',
            field=models.JSONField(
                default=schools.models.default_register_config,
                help_text='Register layout: orientation, header positions, data start positions'
            ),
        ),
    ]
