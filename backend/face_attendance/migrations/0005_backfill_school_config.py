from django.db import migrations

BATCH_SIZE = 500


def backfill_school_config(apps, schema_editor):
    """
    Give every existing school a FaceAttendanceSchoolConfig row that
    reproduces today's exact behavior: tier_c_enabled=True (the only tier
    that has ever existed), tier_a/tier_b off. Zero visible change for any
    school, including schools already live on Tier C in production.
    """
    School = apps.get_model('schools', 'School')
    FaceAttendanceSchoolConfig = apps.get_model('face_attendance', 'FaceAttendanceSchoolConfig')

    existing_school_ids = set(
        FaceAttendanceSchoolConfig.objects.values_list('school_id', flat=True)
    )
    missing_school_ids = list(
        School.objects.exclude(id__in=existing_school_ids).values_list('id', flat=True)
    )

    for start in range(0, len(missing_school_ids), BATCH_SIZE):
        batch_ids = missing_school_ids[start:start + BATCH_SIZE]
        FaceAttendanceSchoolConfig.objects.bulk_create(
            [
                FaceAttendanceSchoolConfig(
                    school_id=school_id,
                    tier_c_enabled=True,
                    tier_b_enabled=False,
                    tier_a_enabled=False,
                )
                for school_id in batch_ids
            ],
            batch_size=BATCH_SIZE,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('face_attendance', '0004_tier_b_models'),
        ('schools', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(backfill_school_config, migrations.RunPython.noop),
    ]
