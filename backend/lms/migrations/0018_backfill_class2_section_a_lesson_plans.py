# One-off data backfill: existing LessonPlan rows for "Class 2" (School id=1,
# students.Class id=5) were all created before section-level tracking existed
# and were, in practice, all Section A's plans. Point them at the Section A
# SessionClass (id=15) so section-scoped filtering doesn't show them as
# "unscoped"/shared. Plan id=79 is excluded per explicit instruction — its
# teacher doesn't match Section A's assignment and needs manual review instead
# of being folded into this backfill.
from django.db import migrations

SCHOOL_ID = 1
CLASS_OBJ_ID = 5
SECTION_A_SESSION_CLASS_ID = 15
EXCLUDED_PLAN_IDS = [79]


def backfill_section_a(apps, schema_editor):
    LessonPlan = apps.get_model('lms', 'LessonPlan')
    LessonPlan.objects.filter(
        school_id=SCHOOL_ID,
        class_obj_id=CLASS_OBJ_ID,
    ).exclude(
        id__in=EXCLUDED_PLAN_IDS,
    ).update(session_class_id=SECTION_A_SESSION_CLASS_ID)


def unset_section_a(apps, schema_editor):
    LessonPlan = apps.get_model('lms', 'LessonPlan')
    LessonPlan.objects.filter(
        school_id=SCHOOL_ID,
        class_obj_id=CLASS_OBJ_ID,
        session_class_id=SECTION_A_SESSION_CLASS_ID,
    ).exclude(
        id__in=EXCLUDED_PLAN_IDS,
    ).update(session_class_id=None)


class Migration(migrations.Migration):

    dependencies = [
        ('lms', '0017_lessonplan_session_class_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_section_a, unset_section_a),
    ]
