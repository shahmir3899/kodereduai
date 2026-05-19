from copy import deepcopy

from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver

from lms.models import ContentBlock, ContentRevision
from lms.tasks import embed_content_block
from core.task_utils import call_task


TRACKED_CONTENT_BLOCK_FIELDS = {'content_text', 'content_rich'}


@receiver(pre_save, sender=ContentBlock)
def capture_content_block_revision_snapshot(sender, instance, update_fields=None, **kwargs):
    if not instance.pk:
        return
    if update_fields and TRACKED_CONTENT_BLOCK_FIELDS.isdisjoint(set(update_fields)):
        return

    previous = sender.objects.filter(pk=instance.pk).values('content_text', 'content_rich').first()
    if previous:
        instance._previous_revision_snapshot = {
            'content_text': previous['content_text'],
            'content_rich': deepcopy(previous['content_rich']),
        }


@receiver(post_save, sender=ContentBlock)
def create_content_block_revision(sender, instance, created, update_fields=None, **kwargs):
    if created:
        return

    previous = getattr(instance, '_previous_revision_snapshot', None)
    if not previous:
        return

    if previous['content_text'] == instance.content_text and previous['content_rich'] == instance.content_rich:
        return

    ContentRevision.objects.create(
        content_block=instance,
        content_text=previous['content_text'] or '',
        content_rich=previous['content_rich'],
        changed_by=getattr(instance, '_revision_changed_by', None),
        revision_note=getattr(instance, '_revision_note', ''),
    )


@receiver(post_save, sender=ContentBlock)
def queue_content_block_embedding(sender, instance, created, update_fields=None, **kwargs):
    skipped_updates = {'embedding', 'updated_at'}
    if update_fields and set(update_fields).issubset(skipped_updates):
        return
    call_task(embed_content_block, instance.id)