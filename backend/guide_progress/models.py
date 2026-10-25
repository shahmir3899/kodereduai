from django.conf import settings
from django.db import models


class GuideProgress(models.Model):
    """One user's progress on one guide video or "Start here" step, per school.

    Advisory only: the browser reports what was played, so a determined user can fake
    it. The server still recomputes completion from the played ranges instead of
    trusting a "done" flag, which keeps honest data consistent across devices.
    """

    class Kind(models.TextChoices):
        VIDEO = 'video', 'Video'
        STEP = 'step', 'Step'

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='guide_progress',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='guide_progress',
    )
    kind = models.CharField(max_length=10, choices=Kind.choices)
    key = models.CharField(max_length=64, help_text='Video id, or guide section id for a step')

    # Merged [start, end] seconds actually played; always a union, never shrinks.
    ranges = models.JSONField(default=list, blank=True)
    seconds_played = models.FloatField(default=0)
    duration = models.FloatField(default=0)
    last_position = models.FloatField(default=0)
    language = models.CharField(max_length=5, blank=True, default='')

    completed_at = models.DateTimeField(null=True, blank=True)
    first_activity = models.DateTimeField(auto_now_add=True)
    last_activity = models.DateTimeField()

    class Meta:
        unique_together = ('school', 'user', 'kind', 'key')
        indexes = [
            models.Index(fields=['school', 'user']),
            models.Index(fields=['school', 'last_activity']),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.kind}:{self.key}"
