# Generated manually — see docs/face-attendance-live-detection-design.md §10
# and the 2026-07-29 product decision: Tier A/C are unconditionally
# available (no per-school flag needed) and Tier B availability is derived
# from FaceCaptureDevice presence/last_seen_at, not a config flag. These
# three booleans no longer gate anything anywhere in the codebase.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('face_attendance', '0007_facematchthresholdsample'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='faceattendanceschoolconfig',
            name='tier_a_enabled',
        ),
        migrations.RemoveField(
            model_name='faceattendanceschoolconfig',
            name='tier_b_enabled',
        ),
        migrations.RemoveField(
            model_name='faceattendanceschoolconfig',
            name='tier_c_enabled',
        ),
    ]
