"""
Library serializers for book categories, books, book issues, and library configuration.
Uses the two-serializer pattern: Read serializer (with nested details) + Create/Write serializer.
"""

from rest_framework import serializers
from .models import BookCategory, Book, BookIssue, LibraryConfiguration


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
        read_only_fields = ['id']


# =============================================================================
# Book Serializers
# =============================================================================

class BookReadSerializer(serializers.ModelSerializer):
    """Read serializer for Book with nested category details and computed fields."""
    category_name = serializers.CharField(
        source='category.name', read_only=True, default=None,
    )
    issued_count = serializers.SerializerMethodField()
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

    def get_issued_count(self, obj):
        """Count of currently issued (not returned) copies."""
        return obj.issues.filter(status='ISSUED').count()


class BookCreateSerializer(serializers.ModelSerializer):
    """Create/write serializer for Book."""

    class Meta:
        model = Book
        fields = [
            'id', 'title', 'author', 'isbn', 'publisher',
            'category', 'total_copies', 'available_copies',
            'shelf_location', 'is_active',
        ]
        read_only_fields = ['id']


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

    class Meta:
        model = BookIssue
        fields = [
            'id', 'school', 'book', 'book_title',
            'borrower_type', 'student', 'staff',
            'borrower_name',
            'issue_date', 'due_date', 'return_date',
            'status', 'fine_amount',
            'issued_by', 'issued_by_name',
        ]
        read_only_fields = ['id', 'issue_date']

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
            'book', 'borrower_type', 'student', 'staff', 'due_date',
        ]

    def validate(self, attrs):
        borrower_type = attrs.get('borrower_type', 'STUDENT')
        student = attrs.get('student')
        staff = attrs.get('staff')

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
        if book and book.available_copies <= 0:
            raise serializers.ValidationError(
                {'book': 'No available copies of this book.'}
            )

        # Check max books limit from LibraryConfiguration
        request = self.context.get('request')
        if request:
            from core.mixins import ensure_tenant_school_id
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
                            status='ISSUED',
                        ).count()
                        if current_issued >= config.max_books_student:
                            raise serializers.ValidationError(
                                {'student': f'Student has already borrowed the maximum of {config.max_books_student} books.'}
                            )
                    elif borrower_type == 'STAFF' and staff:
                        current_issued = BookIssue.objects.filter(
                            school_id=school_id,
                            staff=staff,
                            status='ISSUED',
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
