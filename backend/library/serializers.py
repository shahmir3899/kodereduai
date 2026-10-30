"""
Library serializers for book categories, books, book issues, and library configuration.
Uses the two-serializer pattern: Read serializer (with nested details) + Create/Write serializer.
"""

from django.utils import timezone
from datetime import date
from decimal import Decimal

from rest_framework import serializers

from core.mixins import ensure_tenant_school_id

from .models import BookCategory, Book, BookIssue, LibraryConfiguration

# ISSUED and OVERDUE are both "still out": the reminder job flips ISSUED to OVERDUE,
# and a book in either state counts against stock, borrower limits and the return lists.
OPEN_STATUSES = ('ISSUED', 'OVERDUE')


def _check_school(serializer, attrs, checks):
    """
    Ids come straight from the request body, so a record from another school
    would otherwise be accepted. `checks` maps field -> dotted path to the
    school id on the related object.
    """
    request = serializer.context.get('request')
    school_id = ensure_tenant_school_id(request) if request else None
    if not school_id:
        return
    errors = {}
    for field, path in checks.items():
        obj = attrs.get(field)
        if obj is None:
            continue
        value = obj
        for part in path.split('.'):
            value = getattr(value, part, None)
        if value is not None and value != school_id:
            errors[field] = 'This record does not belong to the active school.'
    if errors:
        raise serializers.ValidationError(errors)


def get_fine_per_day(school_id, cache=None):
    """Fine rate for a school; `cache` (a dict) avoids one query per serialized row."""
    if cache is not None and school_id in cache:
        return cache[school_id]
    config = LibraryConfiguration.objects.filter(school_id=school_id).first()
    rate = config.fine_per_day if config else Decimal('5.00')
    if cache is not None:
        cache[school_id] = rate
    return rate


# =============================================================================
# BookCategory Serializers
# =============================================================================

class BookCategorySerializer(serializers.ModelSerializer):
    """Read and write serializer for BookCategory (flat, simple model)."""

    class Meta:
        model = BookCategory
        fields = [
            'id', 'school', 'name', 'description',
        ]
        read_only_fields = ['id', 'school']

    def validate_name(self, value):
        value = value.strip()
        request = self.context.get('request')
        school_id = ensure_tenant_school_id(request) if request else None
        if school_id:
            clash = BookCategory.objects.filter(school_id=school_id, name__iexact=value)
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError('A category with this name already exists.')
        return value


# =============================================================================
# Book Serializers
# =============================================================================

class BookReadSerializer(serializers.ModelSerializer):
    """Read serializer for Book with nested category details and computed fields."""
    category_name = serializers.CharField(
        source='category.name', read_only=True, default=None,
    )
    issued_count = serializers.IntegerField(read_only=True, default=0)
    available_count = serializers.IntegerField(
        source='available_copies', read_only=True,
    )

    class Meta:
        model = Book
        fields = [
            'id', 'school', 'title', 'author', 'isbn', 'publisher',
            'category', 'category_name',
            'total_copies', 'available_copies', 'available_count',
            'issued_count', 'shelf_location', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class BookCreateSerializer(serializers.ModelSerializer):
    """
    Create/write serializer for Book. Available copies are derived from the total and the
    books still out, never taken from the client, so the two counts cannot drift apart.
    """

    class Meta:
        model = Book
        fields = [
            'id', 'title', 'author', 'isbn', 'publisher',
            'category', 'total_copies', 'available_copies',
            'shelf_location', 'is_active',
        ]
        read_only_fields = ['id', 'available_copies']

    def validate_total_copies(self, value):
        if value < 1:
            raise serializers.ValidationError('A book needs at least 1 copy.')
        if self.instance:
            out = self.instance.issues.filter(status__in=OPEN_STATUSES).count()
            if value < out:
                raise serializers.ValidationError(
                    f'{out} cop{"y is" if out == 1 else "ies are"} currently issued; '
                    f'total copies cannot be lower than that.'
                )
        return value

    def validate(self, attrs):
        _check_school(self, attrs, {'category': 'school_id'})
        return attrs

    def create(self, validated_data):
        validated_data['available_copies'] = validated_data.get('total_copies', 1)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        book = super().update(instance, validated_data)
        out = book.issues.filter(status__in=OPEN_STATUSES).count()
        book.available_copies = max(0, book.total_copies - out)
        book.save(update_fields=['available_copies', 'updated_at'])
        return book


# =============================================================================
# BookIssue Serializers
# =============================================================================

class BookIssueReadSerializer(serializers.ModelSerializer):
    """Read serializer for BookIssue with nested book and borrower details."""
    book_title = serializers.CharField(source='book.title', read_only=True)
    borrower_name = serializers.SerializerMethodField()
    issued_by_name = serializers.CharField(
        source='issued_by.username', read_only=True, default=None,
    )
    days_overdue = serializers.SerializerMethodField()
    estimated_fine = serializers.SerializerMethodField()

    class Meta:
        model = BookIssue
        fields = [
            'id', 'school', 'book', 'book_title',
            'borrower_type', 'student', 'staff',
            'borrower_name',
            'issue_date', 'due_date', 'return_date',
            'status', 'fine_amount', 'notes',
            'issued_by', 'issued_by_name',
            'days_overdue', 'estimated_fine',
        ]
        read_only_fields = ['id', 'issue_date']

    def get_days_overdue(self, obj):
        if obj.status not in OPEN_STATUSES:
            return 0
        return max(0, (timezone.localdate() - obj.due_date).days)

    def get_estimated_fine(self, obj):
        # Admin-only config is read server-side so every role sees the same figure.
        if obj.status not in OPEN_STATUSES:
            return str(obj.fine_amount)
        cache = self.context.setdefault('_fine_rates', {})
        rate = get_fine_per_day(obj.school_id, cache)
        return str(rate * self.get_days_overdue(obj))

    def get_borrower_name(self, obj):
        """Return the borrower's name based on borrower_type."""
        if obj.borrower_type == 'STUDENT' and obj.student:
            return obj.student.name
        elif obj.borrower_type == 'STAFF' and obj.staff:
            return obj.staff.full_name
        return None


class BookIssueCreateSerializer(serializers.ModelSerializer):
    """Create serializer for BookIssue with max books validation."""

    class Meta:
        model = BookIssue
        fields = [
            'book', 'borrower_type', 'student', 'staff', 'due_date', 'notes',
        ]

    def validate(self, attrs):
        borrower_type = attrs.get('borrower_type', 'STUDENT')
        student = attrs.get('student')
        staff = attrs.get('staff')

        _check_school(self, attrs, {
            'book': 'school_id', 'student': 'school_id', 'staff': 'school_id',
        })

        due_date = attrs.get('due_date')
        if due_date and due_date < timezone.localdate():
            raise serializers.ValidationError({'due_date': 'Due date cannot be in the past.'})

        # Validate that the correct borrower is set based on borrower_type
        if borrower_type == 'STUDENT':
            if not student:
                raise serializers.ValidationError(
                    {'student': 'Student is required when borrower_type is STUDENT.'}
                )
            if staff:
                raise serializers.ValidationError(
                    {'staff': 'Staff should not be set when borrower_type is STUDENT.'}
                )
        elif borrower_type == 'STAFF':
            if not staff:
                raise serializers.ValidationError(
                    {'staff': 'Staff is required when borrower_type is STAFF.'}
                )
            if student:
                raise serializers.ValidationError(
                    {'student': 'Student should not be set when borrower_type is STAFF.'}
                )

        # Check book availability
        book = attrs.get('book')
        if book and not book.is_active:
            raise serializers.ValidationError({'book': 'This book is inactive and cannot be issued.'})
        if book and (student or staff):
            same = BookIssue.objects.filter(book=book, status__in=OPEN_STATUSES)
            same = same.filter(student=student) if student else same.filter(staff=staff)
            if same.exists():
                raise serializers.ValidationError(
                    {'book': 'This borrower already has a copy of this book.'}
                )
        if book and book.available_copies <= 0:
            raise serializers.ValidationError(
                {'book': 'No available copies of this book.'}
            )

        # Check max books limit from LibraryConfiguration
        request = self.context.get('request')
        if request:
            school_id = ensure_tenant_school_id(request)
            if school_id:
                try:
                    config = LibraryConfiguration.objects.get(school_id=school_id)
                except LibraryConfiguration.DoesNotExist:
                    config = None

                if config:
                    if borrower_type == 'STUDENT' and student:
                        current_issued = BookIssue.objects.filter(
                            school_id=school_id,
                            student=student,
                            status__in=OPEN_STATUSES,
                        ).count()
                        if current_issued >= config.max_books_student:
                            raise serializers.ValidationError(
                                {'student': f'Student has already borrowed the maximum of {config.max_books_student} books.'}
                            )
                    elif borrower_type == 'STAFF' and staff:
                        current_issued = BookIssue.objects.filter(
                            school_id=school_id,
                            staff=staff,
                            status__in=OPEN_STATUSES,
                        ).count()
                        if current_issued >= config.max_books_staff:
                            raise serializers.ValidationError(
                                {'staff': f'Staff member has already borrowed the maximum of {config.max_books_staff} books.'}
                            )

        return attrs


# =============================================================================
# LibraryConfiguration Serializer
# =============================================================================

class LibraryConfigSerializer(serializers.ModelSerializer):
    """Read/write serializer for LibraryConfiguration."""
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = LibraryConfiguration
        fields = [
            'id', 'school', 'school_name',
            'max_books_student', 'max_books_staff',
            'loan_period_days', 'fine_per_day',
        ]
        read_only_fields = ['id', 'school']
