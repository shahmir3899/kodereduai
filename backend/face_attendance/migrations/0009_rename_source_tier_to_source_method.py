# Renames the "tier" naming out of the schema (confirmed product decision:
# Group Photo capture, Live Mobile capture, and Fixed Camera capture are all
# unconditionally available — no gating concept called "tier" exists
# anywhere anymore). RenameField preserves existing column data untouched;
# the stored 'TIER_A'/'TIER_B' values themselves are rewritten by the
# follow-up data migration (0010), not this one.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('face_attendance', '0008_remove_tier_enable_flags'),
    ]

    operations = [
        migrations.RenameField(
            model_name='facelivedetectionevent',
            old_name='source_tier',
            new_name='source_method',
        ),
        migrations.RenameField(
            model_name='facematchthresholdsample',
            old_name='source_tier',
            new_name='source_method',
        ),
        migrations.AlterField(
            model_name='facelivedetectionevent',
            name='source_method',
            field=models.CharField(
                max_length=15,
                choices=[('LIVE_MOBILE', 'Live Mobile Capture'), ('FIXED_CAMERA', 'Fixed Camera Capture')],
            ),
        ),
        migrations.AlterField(
            model_name='facematchthresholdsample',
            name='source_method',
            field=models.CharField(
                max_length=15,
                choices=[('LIVE_MOBILE', 'Live Mobile Capture'), ('FIXED_CAMERA', 'Fixed Camera Capture')],
            ),
        ),
    ]
