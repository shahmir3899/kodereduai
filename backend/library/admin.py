from django.contrib import admin
from .models import BookCategory, Book, BookIssue, LibraryConfiguration


@admin.register(BookCategory)
class BookCategoryAdmin(admin.ModelAdmin):
    list_display = ['school', 'name', 'description']
    list_filter = ['school']
    search_fields = ['name']


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = [
        'school', 'title', 'author', 'isbn', 'category',
        'total_copies', 'available_copies', 'is_active',
    ]
    list_filter = ['school', 'category', 'is_active']
    search_fields = ['title', 'author', 'isbn']


@admin.register(BookIssue)
class BookIssueAdmin(admin.ModelAdmin):
    list_display = [
        'school', 'book', 'borrower_type', 'student', 'staff',
        'issue_date', 'due_date', 'return_date', 'status', 'fine_amount',
    ]
    list_filter = ['school', 'status', 'borrower_type', 'issue_date']
    search_fields = ['book__title', 'student__name', 'staff__first_name', 'staff__last_name']


@admin.register(LibraryConfiguration)
class LibraryConfigurationAdmin(admin.ModelAdmin):
    list_display = [
        'school', 'max_books_student', 'max_books_staff',
        'loan_period_days', 'fine_per_day',
    ]
    list_filter = ['school']
