from django.utils import timezone

from core.models import AIJob


def create_ai_job(*, job_type, triggered_by=None, school=None, input_data=None, model_used='unknown'):
    return AIJob.objects.create(
        job_type=job_type,
        triggered_by=triggered_by,
        school=school,
        input_data=input_data or {},
        model_used=model_used,
        status=AIJob.Status.PENDING,
    )


def complete_ai_job(job, *, output_data=None, tokens_used=None, accepted=None):
    job.output_data = output_data
    job.tokens_used = tokens_used
    job.status = AIJob.Status.SUCCESS
    job.completed_at = timezone.now()
    if accepted is not None:
        job.accepted = accepted
    job.error_message = ''
    job.save(update_fields=['output_data', 'tokens_used', 'status', 'completed_at', 'accepted', 'error_message'])
    return job


def fail_ai_job(job, *, error_message):
    job.status = AIJob.Status.FAILED
    job.error_message = str(error_message)
    job.completed_at = timezone.now()
    job.save(update_fields=['status', 'error_message', 'completed_at'])
    return job