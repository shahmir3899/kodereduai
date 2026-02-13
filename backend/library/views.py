"""
Library views for book categories, books, book issues, configuration, and stats.
"""

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum, Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id

from .models import BookCategory, Book, BookIssue, LibraryConfiguration
from .serializers import (
    BookCategorySerializer,
    BookReadSerializer, BookCreateSerializer,
    BookIssueReadSerializer, BookIssueCreateSerializer,
    LibraryConfigSerializer,
)


class BookCategoryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for book categories within a school's library."""
    required_module = 'library'
    queryset = BookCategory.objects.all()
    serializer_class = BookCategorySerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None


class BookViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for books with search and issue actions."""
    required_module = 'library'
    queryset = Book.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return BookCreateSerializer
        return BookReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('category')
        # Optional filters
        category_id = self.request.query_params.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    @action(detail=False, methods=['get'])
    def search(self, request):
        """Search books by title, author, or ISBN."""
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response(
                {'detail': 'Query parameter "q" is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = self.get_queryset().filter(
            Q(title__icontains=q) |
            Q(author__icontains=q) |
            Q(isbn__icontains=q)
        )
        serializer = BookReadSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def issue(self, request, pk=None):
        """Issue a specific book to a borrower. Creates a BookIssue and decrements available_copies."""
        book = self.get_object()

        if book.available_copies <= 0:
            return Response(
                {'detail': 'No available copies of this book.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build data for the serializer, injecting the book from the URL
        data = request.data.copy()
        data['book'] = book.id

        serializer = BookIssueCreateSerializer(
            data=data, context={'request': request},
        )
        serializer.is_valid(raise_exception=True)

        school_id = ensure_tenant_school_id(request)

        with transaction.atomic():
            issue_obj = serializer.save(
                school_id=school_id or book.school_id,
                issued_by=request.user,
            )
            # Decrement available copies
            book.available_copies = max(0, book.available_copies - 1)
            book.save(update_fields=['available_copies', 'updated_at'])

        read_serializer = BookIssueReadSerializer(issue_obj)
        return Response(read_serializer.data, status=status.HTTP_201_CREATED)


class BookIssueViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """List, detail, and manage book issues (checkouts/returns)."""
    required_module = 'library'
    queryset = BookIssue.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create',):
            return BookIssueCreateSerializer
        return BookIssueReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'book', 'student', 'staff', 'issued_by',
        )
        # Optional filters
        book_status = self.request.query_params.get('status')
        if book_status:
            queryset = queryset.filter(status=book_status.upper())

        borrower_type = self.request.query_params.get('borrower_type')
        if borrower_type:
            queryset = queryset.filter(borrower_type=borrower_type.upper())

        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        staff_id = self.request.query_params.get('staff_id')
        if staff_id:
            queryset = queryset.filter(staff_id=staff_id)

        book_id = self.request.query_params.get('book_id')
        if book_id:
            queryset = queryset.filter(book_id=book_id)

        return queryset

    def perform_create(self, serializer):
        """Create a book issue and decrement available copies."""
        school_id = ensure_tenant_school_id(self.request)

        with transaction.atomic():
            issue_obj = serializer.save(
                school_id=school_id,
                issued_by=self.request.user,
            )
            book = issue_obj.book
            book.available_copies = max(0, book.available_copies - 1)
            book.save(update_fields=['available_copies', 'updated_at'])

    @action(detail=True, methods=['post'])
    def return_book(self, request, pk=None):
        """
        Return a book: sets return_date, calculates fine based on overdue days,
        updates status to RETURNED, and increments book.available_copies.
        """
        issue = self.get_object()

        if issue.status == 'RETURNED':
            return Response(
                {'detail': 'This book has already been returned.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if issue.status == 'LOST':
            return Response(
                {'detail': 'Cannot return a book marked as lost.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        today = date.today()
        fine_amount = Decimal('0')

        # Calculate fine if overdue
        if today > issue.due_date:
            overdue_days = (today - issue.due_date).days
            # Get fine_per_day from LibraryConfiguration
            try:
                config = LibraryConfiguration.objects.get(school_id=issue.school_id)
                fine_per_day = config.fine_per_day
            except LibraryConfiguration.DoesNotExist:
                fine_per_day = Decimal('5.00')

            fine_amount = Decimal(str(overdue_days)) * fine_per_day

        with transaction.atomic():
            issue.return_date = today
            issue.status = 'RETURNED'
            issue.fine_amount = fine_amount
            issue.save(update_fields=['return_date', 'status', 'fine_amount'])

            # Increment available copies
            book = issue.book
            book.available_copies = min(book.total_copies, book.available_copies + 1)
            book.save(update_fields=['available_copies', 'updated_at'])

        serializer = BookIssueReadSerializer(issue)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def overdue(self, request):
        """List all overdue issues (due_date < today and status is ISSUED)."""
        today = date.today()
        queryset = self.get_queryset().filter(
            due_date__lt=today,
            status='ISSUED',
        )
        serializer = BookIssueReadSerializer(queryset, many=True)
        return Response(serializer.data)


class LibraryConfigViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    Retrieve and update library configuration for a school.
    Single record per school (OneToOne).
    Only admins can view and modify.
    """
    required_module = 'library'
    queryset = LibraryConfiguration.objects.all()
    serializer_class = LibraryConfigSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]
    pagination_class = None

    # Only allow retrieve and partial_update (no list, create, delete via this endpoint)
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_object(self):
        """
        Return the single LibraryConfiguration for the active school.
        Auto-creates one with defaults if it does not exist.
        """
        school_id = ensure_tenant_school_id(self.request)
        if not school_id and self.request.user.school_id:
            school_id = self.request.user.school_id

        config, _created = LibraryConfiguration.objects.get_or_create(
            school_id=school_id,
        )
        self.check_object_permissions(self.request, config)
        return config


class LibraryStatsView(ModuleAccessMixin, APIView):
    """
    GET: Returns aggregate library statistics for the active school.
    {total_books, total_issued, total_overdue, total_categories, total_fine_collected}
    """
    required_module = 'library'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        today = date.today()

        total_books = Book.objects.filter(
            school_id=school_id, is_active=True,
        ).aggregate(total=Sum('total_copies'))['total'] or 0

        total_issued = BookIssue.objects.filter(
            school_id=school_id, status='ISSUED',
        ).count()

        total_overdue = BookIssue.objects.filter(
            school_id=school_id, status='ISSUED', due_date__lt=today,
        ).count()

        total_categories = BookCategory.objects.filter(
            school_id=school_id,
        ).count()

        total_fine_collected = BookIssue.objects.filter(
            school_id=school_id, status='RETURNED',
        ).aggregate(total=Sum('fine_amount'))['total'] or Decimal('0')

        return Response({
            'total_books': total_books,
            'total_issued': total_issued,
            'total_overdue': total_overdue,
            'total_categories': total_categories,
            'total_fine_collected': total_fine_collected,
        })
