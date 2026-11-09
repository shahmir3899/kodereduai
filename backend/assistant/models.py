"""Unified assistant storage.

Replaces the per-agent chat tables (FinanceAIChatMessage, AcademicsAIChatMessage,
StudyHelperMessage). Those stay untouched until the history migration is run.
"""
from django.conf import settings
from django.db import models


class AgentConversation(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='agent_conversations')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_conversations')
    title = models.CharField(max_length=200, blank=True, default='')
    pinned = models.BooleanField(default=False)
    # Rolling summary of messages that fell out of the verbatim window.
    summary = models.TextField(blank=True, default='')
    # Number of messages (oldest first) already folded into `summary`.
    summarized_count = models.PositiveIntegerField(default=0)
    # Things that must outlive the 10-message window: working sets (e.g. the
    # pending-fee records being discussed), resolved entities, pending questions.
    state = models.JSONField(default=dict, blank=True)
    last_active = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-pinned', '-last_active']
        indexes = [models.Index(fields=['school', 'user', '-last_active'])]

    def __str__(self):
        return f'{self.title or "Conversation"} ({self.user_id})'


class AgentMessage(models.Model):
    class Role(models.TextChoices):
        USER = 'user', 'User'
        ASSISTANT = 'assistant', 'Assistant'

    conversation = models.ForeignKey(AgentConversation, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    # Which sub-agent produced the answer (finance, academics, ...). Shown as a chip in the UI.
    sub_agent = models.CharField(max_length=40, blank=True, default='')
    # [{name, sub_agent, args, ok}] for the steps taken while answering; lets the agent remember what it did.
    tool_calls = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['conversation', 'created_at'])]


class AgentAction(models.Model):
    """A write the agent *proposes*. Nothing is executed until a human approves it."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        EDITED = 'edited', 'Edited'
        REJECTED = 'rejected', 'Rejected'
        EXECUTED = 'executed', 'Executed'
        FAILED = 'failed', 'Failed'
        EXPIRED = 'expired', 'Expired'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='agent_actions')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_actions')
    conversation = models.ForeignKey(AgentConversation, null=True, blank=True, on_delete=models.SET_NULL, related_name='actions')
    message = models.ForeignKey(AgentMessage, null=True, blank=True, on_delete=models.SET_NULL, related_name='actions')
    sub_agent = models.CharField(max_length=40)
    tool_name = models.CharField(max_length=80)
    payload = models.JSONField(default=dict)   # exactly what will be sent to the real API
    preview = models.JSONField(default=dict)   # what the approval card shows
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    # Stops a double-click or a retry from executing the same proposal twice.
    idempotency_key = models.CharField(max_length=64, unique=True)
    result = models.JSONField(null=True, blank=True)
    error = models.TextField(blank=True, default='')
    expires_at = models.DateTimeField()
    decided_at = models.DateTimeField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['school', 'user', 'status'])]


class AgentAuditLog(models.Model):
    class Kind(models.TextChoices):
        READ = 'read', 'Read'
        WRITE = 'write', 'Write'
        DENIED = 'denied', 'Denied'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='agent_audit_logs')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_audit_logs')
    conversation = models.ForeignKey(AgentConversation, null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_logs')
    sub_agent = models.CharField(max_length=40, blank=True, default='')
    tool_name = models.CharField(max_length=80)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    args = models.JSONField(default=dict, blank=True)
    ok = models.BooleanField(default=True)
    error = models.TextField(blank=True, default='')
    duration_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['school', '-created_at']), models.Index(fields=['user', '-created_at'])]


class AgentUsageDay(models.Model):
    """What the assistant cost per school, per user, per day (model tokens, calls, fallbacks, voice seconds).

    Exists because the provider counters only know a total per provider: the owner could not tell which school
    spent the free daily budget, and a per-user cap had nothing to read. One row per (school, user, day), updated
    with an atomic increment; a failed write never breaks an answer (see assistant/usage.py)."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='agent_usage_days')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_usage_days')
    date = models.DateField()
    tokens = models.PositiveBigIntegerField(default=0)
    calls = models.PositiveIntegerField(default=0)
    # Calls answered by the second provider because the first was resting or failed.
    fallbacks = models.PositiveIntegerField(default=0)
    voice_seconds = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['school', 'user', 'date'], name='uniq_agent_usage_school_user_date')]
        indexes = [models.Index(fields=['user', 'date']), models.Index(fields=['school', 'date'])]


class AgentGapGroup(models.Model):
    """A cluster of similar "Aura could not do this" requests. Global, not per school: the owner decides
    what to build across all schools; per-school counts are computed from AgentGap."""

    class Status(models.TextChoices):
        NEW = 'new', 'New'
        PLANNED = 'planned', 'Planned'
        BUILT = 'built', 'Built'
        WONT_DO = 'wont_do', "Won't do"

    label = models.CharField(max_length=120)
    description = models.TextField(blank=True, default='')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW)
    note = models.TextField(blank=True, default='')
    # Baseline question that keeps a built gap fixed (text id, not a FK: the questions live in a JSON file).
    baseline_question_id = models.CharField(max_length=60, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.label


class AgentGap(models.Model):
    """One moment where the assistant fell short (no tool, error, denied, card rejected, thumbs down...).

    `summary` is ALWAYS redacted (assistant/redact.py) and is empty for students and parents, whose text
    is never stored. Rows are deleted after 90 days (`delete_after`)."""

    class Kind(models.TextChoices):
        MISSING_TOOL = 'missing_tool', 'Missing tool'
        TOOL_ERROR = 'tool_error', 'Tool error'
        DENIED = 'denied', 'Denied'
        CARD_REJECTED = 'card_rejected', 'Card rejected'
        CARD_EDITED = 'card_edited', 'Card edited'
        CLARIFY_LOOP = 'clarify_loop', 'Clarify loop'
        THUMBS_DOWN = 'thumbs_down', 'Thumbs down'
        THUMBS_UP = 'thumbs_up', 'Thumbs up'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='agent_gaps')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='agent_gaps')
    role = models.CharField(max_length=20, blank=True, default='')
    agent = models.CharField(max_length=40, blank=True, default='')
    kind = models.CharField(max_length=16, choices=Kind.choices)
    language = models.CharField(max_length=10, blank=True, default='')   # en / ur / ur_roman (a guess)
    summary = models.CharField(max_length=300, blank=True, default='')
    tool_hint = models.CharField(max_length=80, blank=True, default='')
    conversation_id = models.PositiveIntegerField(null=True, blank=True)   # plain ints: the gap outlives the chat
    message_id = models.PositiveIntegerField(null=True, blank=True)
    rating = models.SmallIntegerField(null=True, blank=True)   # 1 / -1
    reason = models.CharField(max_length=300, blank=True, default='')
    group = models.ForeignKey(AgentGapGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name='gaps')
    created_at = models.DateTimeField(auto_now_add=True)
    delete_after = models.DateTimeField()

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', '-created_at']),
            models.Index(fields=['delete_after']),
            models.Index(fields=['group']),
        ]
