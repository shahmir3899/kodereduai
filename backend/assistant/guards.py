"""Per-role safety rules that the old agents enforced and the shared loop must keep.

Student chat had a daily message cap and an input/output content filter. Dropping them
when the Study Helper moved onto the shared orchestrator would have been a quiet
regression, so they live here and run for every student turn.
"""
from datetime import timedelta

from django.utils import timezone


class GuardRefusal(Exception):
    """The turn must not run; `str(exc)` is safe to show the user."""


STUDENT_PROMPT = (
    'You are talking to a school student. Be encouraging and age-appropriate. Only help with '
    'school studies; politely steer other topics back to studies. Explain step by step and '
    'encourage the student to think instead of only giving answers. Never share personal '
    'information about anyone. You can only look up THIS student\'s own data.'
)

ROLE_PROMPTS = {'STUDENT': STUDENT_PROMPT}


def check_input(ctx, text: str):
    if ctx.role != 'STUDENT':
        return
    from students.study_helper_service import DAILY_MESSAGE_LIMIT, StudyHelperService

    from .models import AgentMessage

    since = timezone.now() - timedelta(days=1)
    used = AgentMessage.objects.filter(
        conversation__user=ctx.user, role=AgentMessage.Role.USER, created_at__gte=since,
    ).count()
    if used >= DAILY_MESSAGE_LIMIT:
        raise GuardRefusal('Daily message limit reached. Please come back tomorrow.')
    safe, reason = StudyHelperService.check_content_safety(text)
    if not safe:
        raise GuardRefusal(reason)


def check_output(ctx, text: str) -> str:
    if ctx.role != 'STUDENT':
        return text
    from students.study_helper_service import StudyHelperService

    if StudyHelperService._check_output_safety(text):
        return text
    return ("I'm sorry, I can't provide that information. "
            "Let me help you with something related to your studies instead.")
