from django.conf import settings
from django.db import models


class StudentExit(models.Model):
    """One case of a student leaving (withdrawn, or transferred to another branch).

    The case runs OPEN -> FINALIZED (or CANCELLED). While it is open the school
    works through the clearance checklist; finalizing applies the departure to
    the student and closes their enrollment in one transaction. There is no
    separate approval state: the same Principal/admin may start and finalize.
    """

    class ExitType(models.TextChoices):
        WITHDRAWN = 'WITHDRAWN', 'Withdrawn (left school)'
        TRANSFERRED = 'TRANSFERRED', 'Transferred (to another branch)'

    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        FINALIZED = 'FINALIZED', 'Finalized'
        CANCELLED = 'CANCELLED', 'Cancelled'

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='student_exits',
    )
    student = models.ForeignKey(
        'students.Student', on_delete=models.CASCADE, related_name='exits',
    )
    exit_type = models.CharField(max_length=20, choices=ExitType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)

    leaving_date = models.DateField(
        help_text='First day the student is gone (same meaning as StudentEnrollment.left_date).',
    )
    reason = models.TextField(blank=True, default='')
    destination_school = models.ForeignKey(
        'schools.School', null=True, blank=True, on_delete=models.PROTECT,
        related_name='incoming_exits',
        help_text='Required for TRANSFERRED; must be another school of the same organization.',
    )
    # Transfers only: where the student will sit at the destination branch. Chosen in
    # the wizard before finalizing, because the new student record needs a class.
    destination_session_class = models.ForeignKey(
        'academic_sessions.SessionClass', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+',
        help_text='Class (section) at the destination branch the student joins.',
    )
    destination_roll_number = models.CharField(max_length=20, blank=True, default='')
    destination_student = models.ForeignKey(
        'students.Student', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='transfer_in_exit',
        help_text='The new student record created at the destination when this transfer is finalized.',
    )
    remove_records_after_leaving = models.BooleanField(
        default=False,
        help_text='Delete attendance/marks on or after the leaving date when finalizing '
                  '(backed up in the admin audit log first).',
    )

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+',
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+',
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True, default='')

    snapshot = models.JSONField(
        default=dict, blank=True,
        help_text='Class, roll, pending fees and clearance as they were at finalization.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-requested_at', '-id']
        verbose_name = 'Student Exit'
        verbose_name_plural = 'Student Exits'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['student', 'status']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['student'],
                condition=models.Q(status='OPEN'),
                name='one_open_exit_per_student',
            ),
        ]

    def __str__(self):
        return f'{self.get_exit_type_display()} - {self.student.name} ({self.get_status_display()})'


class ExitClearanceItem(models.Model):
    """One obligation that must be cleared (or waived with a reason) before an
    exit can be finalized. State is recomputed from live data on refresh, so
    fixing the underlying problem clears the item without any manual step."""

    class Kind(models.TextChoices):
        FEES = 'FEES', 'Pending fees'
        LIBRARY = 'LIBRARY', 'Library books'
        GATE_PASS = 'GATE_PASS', 'Open gate pass'

    class State(models.TextChoices):
        CLEAR = 'CLEAR', 'Clear'
        OPEN = 'OPEN', 'Open'
        WAIVED = 'WAIVED', 'Waived'
        # Transfers, fees only: the pending balance is handed to the destination branch
        # (a receivable is created there when the transfer is finalized).
        CARRIED = 'CARRIED', 'Carried to new branch'

    exit = models.ForeignKey(StudentExit, on_delete=models.CASCADE, related_name='items')
    kind = models.CharField(max_length=20, choices=Kind.choices)
    state = models.CharField(max_length=10, choices=State.choices, default=State.CLEAR)
    summary = models.CharField(max_length=255, blank=True, default='')
    detail = models.JSONField(default=dict, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # What the situation looked like when it was waived. If it later changes (more
    # fees generated, another book issued) the waiver lapses and the item reopens.
    waived_fingerprint = models.CharField(max_length=255, blank=True, default='')
    waiver_reason = models.TextField(blank=True, default='')
    waived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+',
    )
    waived_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        unique_together = ('exit', 'kind')
        verbose_name = 'Exit Clearance Item'
        verbose_name_plural = 'Exit Clearance Items'

    def __str__(self):
        return f'{self.get_kind_display()}: {self.get_state_display()}'


class EnrollmentBreak(models.Model):
    """A period a student was away from school: opened when an exit is finalized,
    closed when they are re-admitted. The enrollment itself is re-activated on
    return, so without this record the months away would be forgotten; the
    attendance, fee and exam guards read it to leave the gap empty.

    A day is inside the break when start_date <= day < end_date; while end_date is
    empty the student is still away.
    """

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='enrollment_breaks',
    )
    student = models.ForeignKey(
        'students.Student', on_delete=models.CASCADE, related_name='enrollment_breaks',
    )
    exit = models.ForeignKey(
        StudentExit, null=True, blank=True, on_delete=models.SET_NULL, related_name='breaks',
        help_text='The exit that opened this break (empty for backfilled or legacy cases).',
    )
    start_date = models.DateField(help_text='First day away (the leaving date).')
    end_date = models.DateField(
        null=True, blank=True,
        help_text='First day back. Empty while the student is still away.',
    )
    reason = models.TextField(blank=True, default='', help_text='Why they came back (set at re-admission).')
    readmitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    readmitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_date', '-id']
        verbose_name = 'Enrollment Break'
        verbose_name_plural = 'Enrollment Breaks'
        indexes = [
            models.Index(fields=['student', 'start_date']),
            models.Index(fields=['school', 'start_date']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['student'],
                condition=models.Q(end_date__isnull=True),
                name='one_open_break_per_student',
            ),
            models.CheckConstraint(
                condition=models.Q(end_date__isnull=True) | models.Q(end_date__gt=models.F('start_date')),
                name='break_ends_after_it_starts',
            ),
        ]

    def covers(self, day):
        return self.start_date <= day and (self.end_date is None or day < self.end_date)

    def __str__(self):
        end = self.end_date.isoformat() if self.end_date else 'now'
        return f'{self.student.name} away {self.start_date.isoformat()} to {end}'
