# Data migration: rewrites existing 'TIER_A'/'TIER_B' stored values to the
# new 'LIVE_MOBILE'/'FIXED_CAMERA' codes on both tables, following the field
# rename in 0009. FaceLiveDetectionEvent rows are purged 48h after creation
# (see cleanup_old_live_detection_events), so this table should have little
# to no historical data by the time this runs in any given environment.
# FaceMatchThresholdSample is kept indefinitely, so this is the migration
# that actually matters for real data — reversible via reverse_code.

from django.db import migrations

OLD_TO_NEW = {
    'TIER_A': 'LIVE_MOBILE',
    'TIER_B': 'FIXED_CAMERA',
}
NEW_TO_OLD = {new: old for old, new in OLD_TO_NEW.items()}


def forwards(apps, schema_editor):
    FaceLiveDetectionEvent = apps.get_model('face_attendance', 'FaceLiveDetectionEvent')
    FaceMatchThresholdSample = apps.get_model('face_attendance', 'FaceMatchThresholdSample')
    for old, new in OLD_TO_NEW.items():
        FaceLiveDetectionEvent.objects.filter(source_method=old).update(source_method=new)
        FaceMatchThresholdSample.objects.filter(source_method=old).update(source_method=new)


def backwards(apps, schema_editor):
    FaceLiveDetectionEvent = apps.get_model('face_attendance', 'FaceLiveDetectionEvent')
    FaceMatchThresholdSample = apps.get_model('face_attendance', 'FaceMatchThresholdSample')
    for new, old in NEW_TO_OLD.items():
        FaceLiveDetectionEvent.objects.filter(source_method=new).update(source_method=old)
        FaceMatchThresholdSample.objects.filter(source_method=new).update(source_method=old)


class Migration(migrations.Migration):

    dependencies = [
        ('face_attendance', '0009_rename_source_tier_to_source_method'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
