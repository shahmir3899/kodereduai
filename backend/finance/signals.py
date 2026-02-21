"""
Django signals for finance app.
Triggers sibling detection when student data changes.
"""
import logging
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

# Fields that trigger sibling re-detection when changed
SIBLING_RELEVANT_FIELDS = {
    'parent_phone', 'guardian_phone', 'parent_name', 'guardian_name',
}


@receiver(post_save, sender='students.Student')
def trigger_sibling_detection(sender, instance, created, **kwargs):
    """
    On student create: always run detection.
    On student update: run only if sibling-relevant fields changed.
    """
    if not instance.is_active:
        return

    should_detect = False

    if created:
        should_detect = True
    else:
        update_fields = kwargs.get('update_fields')
        if update_fields is None:
            # Full save — always detect
            should_detect = True
        elif SIBLING_RELEVANT_FIELDS & set(update_fields):
            should_detect = True

    if should_detect:
        from finance.tasks import detect_siblings_for_student_task
        detect_siblings_for_student_task.delay(instance.id)
