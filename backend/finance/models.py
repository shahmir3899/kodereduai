from django.db import models


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
        related_name='accounts'
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Account'
        verbose_name_plural = 'Accounts'
        indexes = [
            models.Index(fields=['school', 'is_active']),
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        verbose_name = 'Transfer'
        verbose_name_plural = 'Transfers'
        indexes = [
            models.Index(fields=['school', 'date']),
        ]

    def __str__(self):
        return f"{self.from_account.name} -> {self.to_account.name}: {self.amount} ({self.date})"


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
        on_delete=models.CASCADE,
        related_name='fee_structures',
        null=True,
        blank=True,
        help_text="Override fee for a specific student (takes precedence over class fee)"
    )
    monthly_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Monthly fee amount"
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
        return f"{target} - {self.monthly_amount}/month"


def resolve_fee_amount(student):
    """
    Resolve the monthly fee for a student.
    Priority: student-level FeeStructure > class-level FeeStructure.
    Returns Decimal amount or None if no fee structure found.
    """
    from datetime import date
    today = date.today()

    # Try student-level first
    student_fee = FeeStructure.objects.filter(
        school=student.school,
        student=student,
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
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='fee_payments'
    )
    month = models.IntegerField(help_text="Month number (1-12)")
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
        unique_together = ('school', 'student', 'month', 'year')
        ordering = ['-year', '-month', 'student__class_obj', 'student__roll_number']
        verbose_name = 'Fee Payment'
        verbose_name_plural = 'Fee Payments'
        indexes = [
            models.Index(fields=['school', 'year', 'month']),
            models.Index(fields=['school', 'status']),
        ]

    def __str__(self):
        return f"{self.student.name} - {self.month}/{self.year}: {self.get_status_display()}"

    def save(self, *args, **kwargs):
        """Auto-compute status from amounts."""
        if self.amount_paid >= self.amount_due:
            self.status = self.PaymentStatus.PAID
        elif self.amount_paid > 0:
            self.status = self.PaymentStatus.PARTIAL
        else:
            self.status = self.PaymentStatus.UNPAID
        super().save(*args, **kwargs)


class Expense(models.Model):
    """
    Tracks school expenses with simple category-based classification.
    """
    class Category(models.TextChoices):
        SALARY = 'SALARY', 'Salary'
        RENT = 'RENT', 'Rent'
        UTILITIES = 'UTILITIES', 'Utilities'
        SUPPLIES = 'SUPPLIES', 'Supplies'
        MAINTENANCE = 'MAINTENANCE', 'Maintenance'
        MISC = 'MISC', 'Miscellaneous'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='expenses'
    )
    category = models.CharField(
        max_length=20,
        choices=Category.choices
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        verbose_name = 'Expense'
        verbose_name_plural = 'Expenses'
        indexes = [
            models.Index(fields=['school', 'date']),
            models.Index(fields=['school', 'category']),
        ]

    def __str__(self):
        return f"{self.get_category_display()} - {self.amount} ({self.date})"


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
    class Category(models.TextChoices):
        SALE = 'SALE', 'Sale (Books/Copies/Uniform)'
        DONATION = 'DONATION', 'Donation'
        EVENT = 'EVENT', 'Event Income'
        MISC = 'MISC', 'Miscellaneous'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='other_incomes'
    )
    category = models.CharField(
        max_length=20,
        choices=Category.choices
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        verbose_name = 'Other Income'
        verbose_name_plural = 'Other Incomes'
        indexes = [
            models.Index(fields=['school', 'date']),
            models.Index(fields=['school', 'category']),
        ]

    def __str__(self):
        return f"{self.get_category_display()} - {self.amount} ({self.date})"
