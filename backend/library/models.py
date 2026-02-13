from django.db import models
from django.conf import settings


class BookCategory(models.Model):
    """
    Categories for organizing library books.
    e.g., Fiction, Science, Mathematics, History, etc.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='book_categories',
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Book Category'
        verbose_name_plural = 'Book Categories'

    def __str__(self):
        return self.name


class Book(models.Model):
    """
    Represents a book in the school library.
    Tracks total and available copies for circulation management.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='library_books',
    )
    title = models.CharField(max_length=200)
    author = models.CharField(max_length=200)
    isbn = models.CharField(max_length=20, blank=True)
    publisher = models.CharField(max_length=200, blank=True)
    category = models.ForeignKey(
        BookCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='books',
    )
    total_copies = models.PositiveIntegerField(default=1)
    available_copies = models.PositiveIntegerField(default=1)
    shelf_location = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['title']
        verbose_name = 'Book'
        verbose_name_plural = 'Books'

    def __str__(self):
        return f"{self.title} by {self.author}"


class BookIssue(models.Model):
    """
    Tracks book checkouts (issues) and returns.
    Supports both student and staff borrowers.
    """
    BORROWER_TYPE_CHOICES = [
        ('STUDENT', 'Student'),
        ('STAFF', 'Staff'),
    ]

    STATUS_CHOICES = [
        ('ISSUED', 'Issued'),
        ('RETURNED', 'Returned'),
        ('OVERDUE', 'Overdue'),
        ('LOST', 'Lost'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='book_issues',
    )
    book = models.ForeignKey(
        Book,
        on_delete=models.CASCADE,
        related_name='issues',
    )
    borrower_type = models.CharField(
        max_length=10,
        choices=BORROWER_TYPE_CHOICES,
        default='STUDENT',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='book_issues',
    )
    staff = models.ForeignKey(
        'hr.StaffMember',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='book_issues',
    )
    issue_date = models.DateField(auto_now_add=True)
    due_date = models.DateField()
    return_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default='ISSUED',
    )
    fine_amount = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=0,
    )
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='issued_books',
    )

    class Meta:
        ordering = ['-issue_date']
        verbose_name = 'Book Issue'
        verbose_name_plural = 'Book Issues'

    def __str__(self):
        borrower = self.student.name if self.student else (
            self.staff.full_name if self.staff else 'Unknown'
        )
        return f"{self.book.title} -> {borrower} ({self.status})"


class LibraryConfiguration(models.Model):
    """
    Per-school library configuration.
    Controls loan policies, limits, and fine rates.
    """
    school = models.OneToOneField(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='library_config',
    )
    max_books_student = models.PositiveIntegerField(
        default=3,
        help_text='Maximum books a student can borrow at once',
    )
    max_books_staff = models.PositiveIntegerField(
        default=5,
        help_text='Maximum books a staff member can borrow at once',
    )
    loan_period_days = models.PositiveIntegerField(
        default=14,
        help_text='Default loan period in days',
    )
    fine_per_day = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=5.00,
        help_text='Fine amount per overdue day',
    )

    class Meta:
        verbose_name = 'Library Configuration'
        verbose_name_plural = 'Library Configurations'

    def __str__(self):
        return f"Library Config - {self.school.name}"
