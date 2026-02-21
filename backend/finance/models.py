from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class FeeType(models.TextChoices):
    MONTHLY = 'MONTHLY', 'Monthly'
    ANNUAL = 'ANNUAL', 'Annual'
    ADMISSION = 'ADMISSION', 'Admission'
    BOOKS = 'BOOKS', 'Books'
    FINE = 'FINE', 'Fine'


class Account(models.Model):
    """
    Represents a cash account, bank account, or person account
    through which money flows in or out.
    """
    class AccountType(models.TextChoices):
        CASH = 'CASH', 'Cash'
        BANK = 'BANK', 'Bank'
        PERSON = 'PERSON', 'Person'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='accounts',
        help_text="School this account belongs to (null = shared across org)",
    )
    organization = models.ForeignKey(
        'schools.Organization',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='accounts',
        help_text="Organization this account belongs to (for shared accounts)",
    )
    name = models.CharField(
        max_length=100,
        help_text="e.g. Principal Branch 1, Fund Branch 1, Shah Mir"
    )
    account_type = models.CharField(
        max_length=10,
        choices=AccountType.choices,
        default=AccountType.CASH
    )
    opening_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text="Beginning Balance Forward (BBF)"
    )
    is_active = models.BooleanField(default=True)
    staff_visible = models.BooleanField(
        default=True,
        help_text="Whether staff members can see this account and its transactions"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Account'
        verbose_name_plural = 'Accounts'
        indexes = [
            models.Index(fields=['school', 'is_active']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'name'],
                condition=models.Q(school__isnull=False),
                name='unique_account_name_per_school',
            ),
            models.UniqueConstraint(
                fields=['organization', 'name'],
                condition=models.Q(school__isnull=True),
                name='unique_account_name_per_org',
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_account_type_display()})"


class Transfer(models.Model):
    """
    Records a transfer of money between two accounts.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='transfers'
    )
    from_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='transfers_out'
    )
    to_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='transfers_in'
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )
    date = models.DateField(
        help_text="Date of the transfer"
    )
    description = models.TextField(
        blank=True,
        help_text="Reason or notes for the transfer"
    )
    recorded_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='recorded_transfers'
    )
    is_sensitive = models.BooleanField(
        default=False,
        help_text="Hide this transfer from staff members"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        verbose_name = 'Transfer'
        verbose_name_plural = 'Transfers'
        indexes = [
            models.Index(fields=['school', 'date']),
        ]

    def save(self, *args, **kwargs):
        """Safeguard 2: reject writes to closed periods."""
        if self.date:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id,
                year=self.date.year,
                month=self.date.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.date.year}/{self.date.month:02d} is closed. "
                    f"Reopen it before modifying transfers."
                )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        """Block deletion of transfers in closed periods."""
        if self.date:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id, year=self.date.year, month=self.date.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.date.year}/{self.date.month:02d} is closed. "
                    f"Reopen it before deleting transfers."
                )
        super().delete(*args, **kwargs)

    def __str__(self):
        return f"{self.from_account.name} -> {self.to_account.name}: {self.amount} ({self.date})"


DEFAULT_EXPENSE_CATEGORIES = [
    ('SALARY', 'Salary'),
    ('RENT', 'Rent'),
    ('UTILITIES', 'Utilities'),
    ('SUPPLIES', 'Supplies'),
    ('MAINTENANCE', 'Maintenance'),
    ('MISC', 'Miscellaneous'),
]

DEFAULT_INCOME_CATEGORIES = [
    ('SALE', 'Sale (Books/Copies/Uniform)'),
    ('DONATION', 'Donation'),
    ('EVENT', 'Event Income'),
    ('MISC', 'Miscellaneous'),
]


class ExpenseCategory(models.Model):
    """Custom expense categories per school."""
    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='expense_categories',
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=30, blank=True, help_text="Short code (e.g. SALARY)")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Expense Category'
        verbose_name_plural = 'Expense Categories'

    def __str__(self):
        return self.name


class IncomeCategory(models.Model):
    """Custom income categories per school."""
    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='income_categories',
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=30, blank=True, help_text="Short code (e.g. SALE)")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Income Category'
        verbose_name_plural = 'Income Categories'

    def __str__(self):
        return self.name


class FeeStructure(models.Model):
    """
    Defines monthly fee amount. Can be set at class level or overridden per student.
    Student-level FeeStructure takes precedence over class-level.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='fee_structures'
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fee_structures',
        help_text="Academic year this fee structure applies to"
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='fee_structures',
        verbose_name='Class',
        null=True,
        blank=True,
        help_text="Set fee for an entire class (leave student blank)"
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        related_name='fee_structures',
        null=True,
        blank=True,
        help_text="Override fee for a specific student (takes precedence over class fee)"
    )
    fee_type = models.CharField(
        max_length=20,
        choices=FeeType.choices,
        default=FeeType.MONTHLY,
        help_text="Type of fee: monthly recurring, annual, one-time admission, books, or fine"
    )
    monthly_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Fee amount (field name kept for backward compat; stores amount for any fee type)"
    )
    effective_from = models.DateField(
        help_text="Date from which this fee structure is effective"
    )
    effective_to = models.DateField(
        null=True,
        blank=True,
        help_text="Date until which this fee is effective (null = indefinite)"
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-effective_from']
        verbose_name = 'Fee Structure'
        verbose_name_plural = 'Fee Structures'
        indexes = [
            models.Index(fields=['school', 'class_obj']),
            models.Index(fields=['school', 'student']),
        ]

    def __str__(self):
        target = self.student.name if self.student else (self.class_obj.name if self.class_obj else 'Unknown')
        type_label = self.get_fee_type_display()
        return f"{target} - {self.monthly_amount} ({type_label})"


def resolve_fee_amount(student, fee_type='MONTHLY'):
    """
    Resolve the fee for a student by fee_type.
    Priority: student-level FeeStructure > class-level FeeStructure.
    Returns Decimal amount or None if no fee structure found.
    """
    from datetime import date
    today = date.today()

    # Try student-level first
    student_fee = FeeStructure.objects.filter(
        school=student.school,
        student=student,
        fee_type=fee_type,
        is_active=True,
        effective_from__lte=today,
    ).filter(
        models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
    ).order_by('-effective_from').first()

    if student_fee:
        return student_fee.monthly_amount

    # Fall back to class-level
    class_fee = FeeStructure.objects.filter(
        school=student.school,
        class_obj=student.class_obj,
        student__isnull=True,
        fee_type=fee_type,
        is_active=True,
        effective_from__lte=today,
    ).filter(
        models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
    ).order_by('-effective_from').first()

    if class_fee:
        return class_fee.monthly_amount

    return None


class FeePayment(models.Model):
    """
    Records a fee payment for a specific student and month.
    """
    class PaymentStatus(models.TextChoices):
        PAID = 'PAID', 'Paid'
        PARTIAL = 'PARTIAL', 'Partial'
        UNPAID = 'UNPAID', 'Unpaid'
        ADVANCE = 'ADVANCE', 'Advance'

    class PaymentMethod(models.TextChoices):
        CASH = 'CASH', 'Cash'
        BANK_TRANSFER = 'BANK_TRANSFER', 'Bank Transfer'
        ONLINE = 'ONLINE', 'Online Payment'
        OTHER = 'OTHER', 'Other'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='fee_payments'
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fee_payments',
        help_text="Academic year this payment belongs to"
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fee_payments'
    )
    fee_type = models.CharField(
        max_length=20,
        choices=FeeType.choices,
        default=FeeType.MONTHLY,
        help_text="Type of fee this payment record belongs to"
    )
    month = models.IntegerField(help_text="Month number (1-12 for monthly, 0 for annual/admission/books/fine)")
    year = models.IntegerField(help_text="Year (e.g. 2026)")
    amount_due = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Total amount due for this month"
    )
    previous_balance = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="Carried-forward balance from previous month"
    )
    amount_paid = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="Amount actually paid"
    )
    status = models.CharField(
        max_length=10,
        choices=PaymentStatus.choices,
        default=PaymentStatus.UNPAID
    )
    payment_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date when payment was received"
    )
    payment_method = models.CharField(
        max_length=20,
        choices=PaymentMethod.choices,
        default=PaymentMethod.CASH
    )
    receipt_number = models.CharField(
        max_length=50,
        blank=True,
        help_text="Manual receipt number for reference"
    )
    notes = models.TextField(
        blank=True,
        help_text="Any notes about this payment"
    )
    collected_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fee_collections'
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fee_payments',
        help_text="Account that received this payment"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'student', 'month', 'year', 'fee_type')
        ordering = ['-year', '-month', 'student__class_obj', 'student__roll_number']
        verbose_name = 'Fee Payment'
        verbose_name_plural = 'Fee Payments'
        indexes = [
            models.Index(fields=['school', 'year', 'month']),
            models.Index(fields=['school', 'status']),
            models.Index(fields=['school', 'fee_type']),
        ]

    def __str__(self):
        type_label = self.get_fee_type_display() if self.fee_type != 'MONTHLY' else ''
        prefix = f"[{type_label}] " if type_label else ''
        student_name = self.student.name if self.student else 'Deleted Student'
        return f"{prefix}{student_name} - {self.month}/{self.year}: {self.get_status_display()}"

    def save(self, *args, **kwargs):
        """Validate payment fields, check period locks, then auto-compute status."""
        # --- Safeguard 1: enforce payment_date + account when money received ---
        if self.amount_paid and self.amount_paid > 0:
            missing = []
            if not self.payment_date:
                missing.append('payment_date')
            if not self.account_id:
                missing.append('account')
            if missing:
                raise ValidationError(
                    f"Cannot record payment without: {', '.join(missing)}. "
                    f"amount_paid={self.amount_paid} requires both payment_date and account."
                )

        # --- Safeguard 2: reject writes to closed periods ---
        # Only check period lock for MONTHLY fees (month 1-12).
        # ANNUAL/ADMISSION/BOOKS/FINE use month=0 and are not tied to a calendar month.
        if self.month >= 1 and self.month <= 12:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id,
                year=self.year,
                month=self.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.year}/{self.month:02d} is closed. "
                    f"Reopen it before modifying fee records."
                )

        if self.amount_due == 0 and self.amount_paid == 0:
            self.status = self.PaymentStatus.PAID
        elif self.amount_due <= 0:
            # Covered by advance from previous month
            self.status = self.PaymentStatus.ADVANCE
        elif self.amount_paid >= self.amount_due:
            self.status = self.PaymentStatus.PAID
        elif self.amount_paid > 0:
            self.status = self.PaymentStatus.PARTIAL
        else:
            self.status = self.PaymentStatus.UNPAID

        # Clear payment metadata when fee becomes UNPAID
        if self.status == self.PaymentStatus.UNPAID:
            self.payment_date = None
            self.account = None
            self.receipt_number = ''

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        """Block deletion of fee records in closed periods (monthly only)."""
        if self.month >= 1 and self.month <= 12:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id, year=self.year, month=self.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.year}/{self.month:02d} is closed. "
                    f"Reopen it before deleting fee records."
                )
        super().delete(*args, **kwargs)


class Expense(models.Model):
    """
    Tracks school expenses with simple category-based classification.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='expenses'
    )
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.PROTECT,
        related_name='expenses',
        null=True,
        blank=True,
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2
    )
    date = models.DateField(
        help_text="Date the expense was incurred"
    )
    description = models.TextField(
        blank=True,
        help_text="Description of the expense"
    )
    recorded_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='recorded_expenses'
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='expenses',
        help_text="Account from which this expense was paid"
    )
    is_sensitive = models.BooleanField(
        default=False,
        help_text="Hide this expense from staff members"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        verbose_name = 'Expense'
        verbose_name_plural = 'Expenses'
        indexes = [
            models.Index(fields=['school', 'date']),
        ]

    def save(self, *args, **kwargs):
        """Safeguard 2: reject writes to closed periods."""
        if self.date:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id,
                year=self.date.year,
                month=self.date.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.date.year}/{self.date.month:02d} is closed. "
                    f"Reopen it before modifying expenses."
                )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        """Block deletion of expenses in closed periods."""
        if self.date:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id, year=self.date.year, month=self.date.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.date.year}/{self.date.month:02d} is closed. "
                    f"Reopen it before deleting expenses."
                )
        super().delete(*args, **kwargs)

    def __str__(self):
        cat_name = self.category.name if self.category else 'Uncategorized'
        return f"{cat_name} - {self.amount} ({self.date})"


class FinanceAIChatMessage(models.Model):
    """
    Stores chat messages between users and the Finance AI assistant.
    """
    class Role(models.TextChoices):
        USER = 'user', 'User'
        ASSISTANT = 'assistant', 'Assistant'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='finance_chat_messages'
    )
    user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='finance_chat_messages'
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    metadata = models.JSONField(
        null=True,
        blank=True,
        help_text="Optional metadata: query data used, tokens, etc."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Finance AI Chat Message'
        verbose_name_plural = 'Finance AI Chat Messages'
        indexes = [
            models.Index(fields=['school', 'user', 'created_at']),
        ]

    def __str__(self):
        return f"{self.user.username} [{self.role}]: {self.content[:50]}"


class OtherIncome(models.Model):
    """
    Tracks non-student-linked income (book sales, donations, events, etc.).
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='other_incomes'
    )
    category = models.ForeignKey(
        IncomeCategory,
        on_delete=models.PROTECT,
        related_name='incomes',
        null=True,
        blank=True,
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2
    )
    date = models.DateField(
        help_text="Date the income was received"
    )
    description = models.TextField(
        blank=True,
        help_text="Description of the income"
    )
    recorded_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='recorded_other_incomes'
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='other_incomes',
        help_text="Account that received this income"
    )
    is_sensitive = models.BooleanField(
        default=False,
        help_text="Hide this income from staff members"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        verbose_name = 'Other Income'
        verbose_name_plural = 'Other Incomes'
        indexes = [
            models.Index(fields=['school', 'date']),
        ]

    def save(self, *args, **kwargs):
        """Safeguard 2: reject writes to closed periods."""
        if self.date:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id,
                year=self.date.year,
                month=self.date.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.date.year}/{self.date.month:02d} is closed. "
                    f"Reopen it before modifying income records."
                )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        """Block deletion of income records in closed periods."""
        if self.date:
            is_locked = MonthlyClosing.objects.filter(
                school_id=self.school_id, year=self.date.year, month=self.date.month,
            ).exists()
            if is_locked:
                raise ValidationError(
                    f"Period {self.date.year}/{self.date.month:02d} is closed. "
                    f"Reopen it before deleting income records."
                )
        super().delete(*args, **kwargs)

    def __str__(self):
        cat_name = self.category.name if self.category else 'Uncategorized'
        return f"{cat_name} - {self.amount} ({self.date})"


class MonthlyClosing(models.Model):
    """
    Represents the closing of a calendar month for a school.
    Creates AccountSnapshot records with pre-computed balances so that
    future balance queries only need to sum transactions after the snapshot.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='monthly_closings',
    )
    year = models.IntegerField(help_text="Calendar year, e.g. 2026")
    month = models.IntegerField(help_text="Calendar month (1-12)")
    closed_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='closed_months',
    )
    closed_at = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = ('school', 'year', 'month')
        ordering = ['-year', '-month']
        verbose_name = 'Monthly Closing'
        verbose_name_plural = 'Monthly Closings'

    def __str__(self):
        return f"{self.school} - {self.year}/{self.month:02d}"


class AccountSnapshot(models.Model):
    """
    Per-account balance snapshot at the end of a closed month.
    closing_balance is the net balance as of the last day of the month.
    """
    closing = models.ForeignKey(
        MonthlyClosing,
        on_delete=models.CASCADE,
        related_name='snapshots',
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='snapshots',
    )
    closing_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Net balance as of last day of the closed month",
    )
    opening_balance_used = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text="BBF used to compute this snapshot",
    )
    receipts = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payments = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    transfers_in = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    transfers_out = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('closing', 'account')
        ordering = ['account__name']
        verbose_name = 'Account Snapshot'
        verbose_name_plural = 'Account Snapshots'

    def __str__(self):
        return f"{self.account.name} @ {self.closing.year}/{self.closing.month:02d}: {self.closing_balance}"


# =============================================================================
# Phase 3: Discount & Scholarship Models
# =============================================================================

class Discount(models.Model):
    """Defines a discount rule that can be applied to fee structures."""
    DISCOUNT_TYPE_CHOICES = [
        ('PERCENTAGE', 'Percentage'),
        ('FIXED', 'Fixed Amount'),
    ]
    APPLIES_TO_CHOICES = [
        ('ALL', 'All Students'),
        ('GRADE_LEVEL', 'All classes at a grade level'),
        ('CLASS', 'Specific Class'),
        ('STUDENT', 'Individual Student'),
        ('SIBLING', 'Siblings (auto-detect)'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='discounts',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='discounts',
    )
    name = models.CharField(max_length=100)
    discount_type = models.CharField(max_length=20, choices=DISCOUNT_TYPE_CHOICES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    applies_to = models.CharField(max_length=20, choices=APPLIES_TO_CHOICES, default='ALL')
    target_grade_level = models.IntegerField(
        null=True,
        blank=True,
        help_text="Grade level to apply discount to (when applies_to=GRADE_LEVEL)",
    )
    target_class = models.ForeignKey(
        'students.Class',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='discounts',
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    max_uses = models.IntegerField(null=True, blank=True)
    stackable = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Discount'
        verbose_name_plural = 'Discounts'
        indexes = [models.Index(fields=['school', 'is_active'])]

    def __str__(self):
        return f"{self.name} ({self.get_discount_type_display()}: {self.value})"


class Scholarship(models.Model):
    """Named scholarship programs with eligibility criteria."""
    TYPE_CHOICES = [
        ('MERIT', 'Merit-Based'),
        ('NEED', 'Need-Based'),
        ('SPORTS', 'Sports'),
        ('STAFF_CHILD', 'Staff Child'),
        ('OTHER', 'Other'),
    ]
    COVERAGE_CHOICES = [
        ('FULL', 'Full Fee Waiver'),
        ('PERCENTAGE', 'Percentage Off'),
        ('FIXED', 'Fixed Amount Off'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='scholarships',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='scholarships',
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default='')
    scholarship_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    coverage = models.CharField(max_length=20, choices=COVERAGE_CHOICES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    max_recipients = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Scholarship'
        verbose_name_plural = 'Scholarships'
        indexes = [models.Index(fields=['school', 'is_active'])]

    def __str__(self):
        return f"{self.name} ({self.get_scholarship_type_display()})"


class StudentDiscount(models.Model):
    """Tracks which discounts/scholarships are applied to which students."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='student_discounts',
    )
    discount = models.ForeignKey(
        Discount,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='student_assignments',
    )
    scholarship = models.ForeignKey(
        Scholarship,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='student_assignments',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
    )
    approved_by = models.ForeignKey(
        'users.User',
        null=True,
        on_delete=models.SET_NULL,
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Student Discount'
        verbose_name_plural = 'Student Discounts'
        indexes = [
            models.Index(fields=['school', 'student', 'academic_year']),
        ]

    def __str__(self):
        target = self.discount.name if self.discount else (self.scholarship.name if self.scholarship else 'N/A')
        student_name = self.student.name if self.student else 'Deleted Student'
        return f"{student_name} - {target}"


# =============================================================================
# Phase 3b: Sibling Detection & Grouping Models
# =============================================================================

class SiblingGroup(models.Model):
    """A confirmed group of sibling students within a school."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='sibling_groups',
    )
    name = models.CharField(
        max_length=200,
        blank=True,
        default='',
        help_text="Auto-generated label, e.g. 'Khan Family (3 siblings)'",
    )
    confirmed_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Sibling Group'
        verbose_name_plural = 'Sibling Groups'
        indexes = [
            models.Index(fields=['school', 'is_active']),
        ]

    def __str__(self):
        return self.name or f"Sibling Group #{self.id}"


class SiblingGroupMember(models.Model):
    """Links a student to a sibling group. order_index determines discount priority."""
    group = models.ForeignKey(
        SiblingGroup,
        on_delete=models.CASCADE,
        related_name='members',
    )
    student = models.OneToOneField(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='sibling_membership',
    )
    order_index = models.PositiveIntegerField(
        default=0,
        help_text="0 = eldest/first enrolled (pays full), 1+ = gets sibling discount",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order_index']
        unique_together = ('group', 'student')
        verbose_name = 'Sibling Group Member'
        verbose_name_plural = 'Sibling Group Members'
        indexes = [
            models.Index(fields=['student']),
        ]

    def __str__(self):
        return f"{self.student.name} in {self.group} (order={self.order_index})"


class SiblingSuggestion(models.Model):
    """Pending sibling detection for admin review."""
    STATUS_CHOICES = [
        ('PENDING', 'Pending Review'),
        ('CONFIRMED', 'Confirmed'),
        ('REJECTED', 'Rejected'),
        ('DISMISSED', 'Dismissed'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='sibling_suggestions',
    )
    student_a = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='sibling_suggestions_as_a',
    )
    student_b = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='sibling_suggestions_as_b',
    )
    confidence_score = models.IntegerField(
        help_text="Computed match score (0-100)",
    )
    match_signals = models.JSONField(
        default=dict,
        help_text="Which signals matched: {'parent_phone': true, 'parent_name': true, ...}",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='PENDING',
    )
    reviewed_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_sibling_suggestions',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    sibling_group = models.ForeignKey(
        SiblingGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="Set when suggestion is confirmed and group is created/joined",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-confidence_score', '-created_at']
        verbose_name = 'Sibling Suggestion'
        verbose_name_plural = 'Sibling Suggestions'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['student_a']),
            models.Index(fields=['student_b']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'student_a', 'student_b'],
                condition=models.Q(status='PENDING'),
                name='unique_pending_suggestion_pair',
            ),
        ]

    def __str__(self):
        return f"Suggestion: {self.student_a.name} <-> {self.student_b.name} ({self.confidence_score}%)"


# =============================================================================
# Phase 3: Payment Gateway Models
# =============================================================================

class PaymentGatewayConfig(models.Model):
    """Per-school payment gateway configuration."""
    GATEWAY_CHOICES = [
        ('STRIPE', 'Stripe'),
        ('RAZORPAY', 'Razorpay'),
        ('JAZZCASH', 'JazzCash'),
        ('EASYPAISA', 'Easypaisa'),
        ('MANUAL', 'Manual/Offline'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='payment_gateways',
    )
    gateway = models.CharField(max_length=20, choices=GATEWAY_CHOICES)
    is_active = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    config = models.JSONField(
        default=dict,
        help_text='Gateway-specific config: api_key, secret, webhook_secret',
    )
    currency = models.CharField(max_length=3, default='PKR')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'gateway')
        verbose_name = 'Payment Gateway Config'
        verbose_name_plural = 'Payment Gateway Configs'

    def __str__(self):
        return f"{self.school.name} - {self.get_gateway_display()}"


class OnlinePayment(models.Model):
    """Tracks individual online payment transactions."""
    STATUS_CHOICES = [
        ('INITIATED', 'Initiated'),
        ('PENDING', 'Pending'),
        ('SUCCESS', 'Success'),
        ('FAILED', 'Failed'),
        ('REFUNDED', 'Refunded'),
        ('EXPIRED', 'Expired'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='online_payments',
    )
    fee_payment = models.ForeignKey(
        FeePayment,
        on_delete=models.CASCADE,
        related_name='online_payments',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='online_payments',
    )
    gateway = models.CharField(max_length=20)
    gateway_order_id = models.CharField(max_length=100, unique=True)
    gateway_payment_id = models.CharField(max_length=100, blank=True, default='')
    gateway_signature = models.CharField(max_length=255, blank=True, default='')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='PKR')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='INITIATED',
    )
    gateway_response = models.JSONField(default=dict)
    initiated_by = models.ForeignKey(
        'users.User',
        null=True,
        on_delete=models.SET_NULL,
    )
    initiated_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-initiated_at']
        verbose_name = 'Online Payment'
        verbose_name_plural = 'Online Payments'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['gateway_order_id']),
            models.Index(fields=['student', 'status']),
        ]

    def __str__(self):
        student_name = self.student.name if self.student else 'Deleted Student'
        return f"{student_name} - {self.amount} {self.currency} ({self.get_status_display()})"
