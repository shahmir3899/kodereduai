from django.db import migrations

# The Academics-chapter videos were copies of the Setup-chapter recordings; the guide now shows the
# same video in both places under one id, so progress saved under the old ids must follow it.
MERGED = {
    'ch5-managing-subjects': 'ch2-step-4-add-subjects',
    'ch5-academic-sessions-years-terms': 'ch2-step-1-academic-year-terms',
}


def merge_progress(apps, schema_editor):
    GuideProgress = apps.get_model('guide_progress', 'GuideProgress')
    for old, new in MERGED.items():
        for row in GuideProgress.objects.filter(kind='video', key=old):
            kept = GuideProgress.objects.filter(
                school_id=row.school_id, user_id=row.user_id, kind='video', key=new,
            ).first()
            if kept is None:
                row.key = new
                row.save(update_fields=['key'])
                continue
            # Keep whichever copy was played further, and never lose a completion.
            if row.seconds_played > kept.seconds_played:
                kept.ranges = row.ranges
                kept.seconds_played = row.seconds_played
                kept.duration = row.duration
                kept.last_position = row.last_position
                kept.language = row.language
            if row.completed_at and (not kept.completed_at or row.completed_at < kept.completed_at):
                kept.completed_at = row.completed_at
            if row.last_activity > kept.last_activity:
                kept.last_activity = row.last_activity
            kept.save()
            row.delete()


class Migration(migrations.Migration):

    dependencies = [('guide_progress', '0001_initial')]

    operations = [migrations.RunPython(merge_progress, migrations.RunPython.noop)]
