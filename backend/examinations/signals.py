from copy import deepcopy

from django.db.models import F
from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.utils import timezone

from examinations.models import PaperQuestion, Question, QuestionRevision
from examinations.tasks import embed_question
from core.task_utils import call_task
from core.task_utils import call_task


TRACKED_QUESTION_FIELDS = {
    'subject_id', 'exam_type_id', 'question_text', 'question_image_url',
    'question_type', 'difficulty_level', 'bloom_level', 'marks',
    'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
    'answer_text', 'type_data', 'source_content_block_id', 'is_ai_generated',
    'verified_by_id', 'verified_at', 'is_active',
}


def _build_question_revision_snapshot(question):
    snapshot = question.build_snapshot()
    snapshot.update({
        'bloom_level': question.bloom_level,
        'source_content_block_id': question.source_content_block_id,
        'is_ai_generated': question.is_ai_generated,
        'verified_by_id': question.verified_by_id,
        'verified_at': question.verified_at.isoformat() if question.verified_at else None,
        'is_active': question.is_active,
        'exam_type_id': question.exam_type_id,
    })
    return snapshot


@receiver(pre_save, sender=Question)
def capture_question_revision_snapshot(sender, instance, update_fields=None, **kwargs):
    if not instance.pk:
        return
    if update_fields and TRACKED_QUESTION_FIELDS.isdisjoint(set(update_fields)):
        return

    previous = sender.objects.select_related('subject').prefetch_related('tested_topics__chapter__book').filter(pk=instance.pk).first()
    if previous is None:
        return

    current_state = {
        'subject_id': instance.subject_id,
        'exam_type_id': instance.exam_type_id,
        'question_text': instance.question_text,
        'question_image_url': instance.question_image_url,
        'question_type': instance.question_type,
        'difficulty_level': instance.difficulty_level,
        'bloom_level': instance.bloom_level,
        'marks': instance.marks,
        'option_a': instance.option_a,
        'option_b': instance.option_b,
        'option_c': instance.option_c,
        'option_d': instance.option_d,
        'correct_answer': instance.correct_answer,
        'answer_text': instance.answer_text,
        'type_data': instance.type_data,
        'source_content_block_id': instance.source_content_block_id,
        'is_ai_generated': instance.is_ai_generated,
        'verified_by_id': instance.verified_by_id,
        'verified_at': instance.verified_at,
        'is_active': instance.is_active,
    }
    previous_state = {
        'subject_id': previous.subject_id,
        'exam_type_id': previous.exam_type_id,
        'question_text': previous.question_text,
        'question_image_url': previous.question_image_url,
        'question_type': previous.question_type,
        'difficulty_level': previous.difficulty_level,
        'bloom_level': previous.bloom_level,
        'marks': previous.marks,
        'option_a': previous.option_a,
        'option_b': previous.option_b,
        'option_c': previous.option_c,
        'option_d': previous.option_d,
        'correct_answer': previous.correct_answer,
        'answer_text': previous.answer_text,
        'type_data': deepcopy(previous.type_data),
        'source_content_block_id': previous.source_content_block_id,
        'is_ai_generated': previous.is_ai_generated,
        'verified_by_id': previous.verified_by_id,
        'verified_at': previous.verified_at,
        'is_active': previous.is_active,
    }
    if previous_state == current_state:
        return

    instance._previous_revision_snapshot = {
        'question_text': previous.question_text,
        'snapshot': _build_question_revision_snapshot(previous),
    }


@receiver(post_save, sender=Question)
def create_question_revision(sender, instance, created, update_fields=None, **kwargs):
    if created:
        return

    previous = getattr(instance, '_previous_revision_snapshot', None)
    if not previous:
        return

    QuestionRevision.objects.create(
        question=instance,
        question_text=previous['question_text'],
        snapshot=previous['snapshot'],
        changed_by=getattr(instance, '_revision_changed_by', None),
    )


@receiver(post_save, sender=Question)
def queue_question_embedding(sender, instance, created, update_fields=None, **kwargs):
    skipped_updates = {'embedding', 'updated_at'}
    if update_fields and set(update_fields).issubset(skipped_updates):
        return
    call_task(embed_question, instance.id)


@receiver(post_save, sender=PaperQuestion)
def update_question_reuse_tracking(sender, instance, created, **kwargs):
    if not created:
        return

    Question.objects.filter(pk=instance.question_id).update(
        paper_use_count=F('paper_use_count') + 1,
        last_used_in_id=instance.exam_paper_id,
        last_used_at=timezone.now(),
    )