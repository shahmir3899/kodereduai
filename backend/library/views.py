"""
Library views for book categories, books, book issues, configuration, and stats.
"""

from django.utils import timezone
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum, Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
    get_effective_role, get_parent_children_ids,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id

from .models import BookCategory, Book, BookIssue, LibraryConfiguration
from .serializers import (
    OPEN_STATUSES, get_fine_per_day,
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



class BookViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for books with search and issue actions."""
    required_module = 'library'
    queryset = Book.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return BookCreateSerializer
        return BookReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('category').annotate(
            issued_count=Count('issues', filter=Q(issues__status__in=OPEN_STATUSES)),
        )
        # Optional filters
        search = self.request.query_params.get('search', '').strip()
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(author__icontains=search) | Q(isbn__icontains=search)
            )

        category_id = self.request.query_params.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    def destroy(self, request, *args, **kwargs):
        book = self.get_object()
        # Issue rows cascade with the book, which would erase who borrowed it and any fines.
        if book.issues.exists():
            return Response(
                {'detail': 'This book has issue history and cannot be deleted. '
                           'Deactivate it instead (Edit, untick Active).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def issue(self, request, pk=None):
        """Issue a specific book to a borrower. Creates a BookIssue and decrements available_copies."""
        book = self.get_object()

        # Build data for the serializer, injecting the book from the URL
        data = request.data.copy()
        data['book'] = book.id

        serializer = BookIssueCreateSerializer(
            data=data, context={'request': request},
        )
        serializer.is_valid(raise_exception=True)

        school_id = ensure_tenant_school_id(request)

        with transaction.atomic():
            # Lock the row so two simultaneous issues cannot both take the last copy.
            book = Book.objects.select_for_update().get(pk=book.pk)
            if book.available_copies <= 0:
                return Response(
                    {'detail': 'No available copies of this book.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            issue_obj = serializer.save(
                school_id=school_id or book.school_id,
                issued_by=request.user,
            )
            book.available_copies = max(0, book.available_copies - 1)
            book.save(update_fields=['available_copies', 'updated_at'])

        read_serializer = BookIssueReadSerializer(issue_obj)
        return Response(read_serializer.data, status=status.HTTP_201_CREATED)


class BookIssueViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """List, detail, and manage book issues (checkouts/returns)."""
    required_module = 'library'
    queryset = BookIssue.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    # Issues are created and returned through their own endpoints; a generic PATCH could
    # rewrite the status and a DELETE would not give the copy back.
    http_method_names = ['get', 'post', 'head', 'options']

    def get_serializer_class(self):
        if self.action in ('create',):
            return BookIssueCreateSerializer
        return BookIssueReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'book', 'student', 'staff', 'issued_by',
        )
        # Optional filters
        # `status` takes one value or a comma list, e.g. ISSUED,OVERDUE for "still out".
        book_status = self.request.query_params.get('status')
        if book_status:
            queryset = queryset.filter(
                status__in=[v.strip().upper() for v in book_status.split(',') if v.strip()]
            )

        search = self.request.query_params.get('search', '').strip()
        if search:
            queryset = queryset.filter(
                Q(book__title__icontains=search)
                | Q(student__name__icontains=search)
                | Q(staff__first_name__icontains=search)
                | Q(staff__last_name__icontains=search)
            )

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

        # Security fix (2026-09): PARENT/STUDENT get read access via
        # IsSchoolAdminOrReadOnly like everyone else, but with no ownership
        # scoping that unrestricted read let them see every student's book
        # issues in the school. Scope to their own child(ren)/self.
        role = get_effective_role(self.request)
        if role == 'PARENT':
            queryset = queryset.filter(student_id__in=get_parent_children_ids(self.request))
        elif role == 'STUDENT':
            queryset = queryset.filter(student__user_profile__user=self.request.user)

        return queryset

    def create(self, request, *args, **kwargs):
        """Answer with the full issue (id, book title, borrower name), not the write fields."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            BookIssueReadSerializer(serializer.instance, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_create(self, serializer):
        """Create a book issue and decrement available copies."""
        school_id = ensure_tenant_school_id(self.request)

        with transaction.atomic():
            book = Book.objects.select_for_update().get(pk=serializer.validated_data['book'].pk)
            if book.available_copies <= 0:
                raise ValidationError({'book': 'No available copies of this book.'})
            issue_obj = serializer.save(
                school_id=school_id,
                issued_by=self.request.user,
            )
            book.available_copies = max(0, book.available_copies - 1)
            book.save(update_fields=['available_copies', 'updated_at'])

    @action(detail=True, methods=['post'])
    def return_book(self, request, pk=None):
        """
        Return a book: sets return_date, calculates fine based on overdue days,
        updates status to RETURNED, and increments book.available_copies.
        """
        with transaction.atomic():
            # Lock the row: a double click must not return the same copy twice.
            issue = BookIssue.objects.select_for_update().select_related('book').get(
                pk=self.get_object().pk,
            )

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

            today = timezone.localdate()
            fine_amount = Decimal('0')
            if today > issue.due_date:
                overdue_days = (today - issue.due_date).days
                fine_amount = Decimal(str(overdue_days)) * get_fine_per_day(issue.school_id)

            issue.return_date = today
            issue.status = 'RETURNED'
            issue.fine_amount = fine_amount
            issue.save(update_fields=['return_date', 'status', 'fine_amount'])

            book = issue.book
            book.available_copies = min(book.total_copies, book.available_copies + 1)
            book.save(update_fields=['available_copies', 'updated_at'])

        serializer = BookIssueReadSerializer(issue)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def overdue(self, request):
        """List all overdue issues (due_date < today and the book is still out)."""
        today = timezone.localdate()
        queryset = self.get_queryset().filter(
            due_date__lt=today,
            status__in=OPEN_STATUSES,
        ).order_by('due_date')
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


def build_stats_summary(school_id):
    """Shared by LibraryStatsView and the admin-dashboard bootstrap."""
    today = timezone.localdate()

    active_books = Book.objects.filter(school_id=school_id, is_active=True)
    total_copies = active_books.aggregate(total=Sum('total_copies'))['total'] or 0
    total_titles = active_books.count()

    total_issued = BookIssue.objects.filter(
        school_id=school_id, status__in=OPEN_STATUSES,
    ).count()

    total_overdue = BookIssue.objects.filter(
        school_id=school_id, status__in=OPEN_STATUSES, due_date__lt=today,
    ).count()

    most_issued_books = [
        {'id': b.id, 'title': b.title, 'author': b.author, 'issue_count': b.issue_count}
        for b in Book.objects.filter(school_id=school_id)
        .annotate(issue_count=Count('issues')).filter(issue_count__gt=0)
        .order_by('-issue_count', 'title')[:5]
    ]

    total_categories = BookCategory.objects.filter(
        school_id=school_id,
    ).count()

    total_fine_collected = BookIssue.objects.filter(
        school_id=school_id, status='RETURNED',
    ).aggregate(total=Sum('fine_amount'))['total'] or Decimal('0')

    return {
        # total_books stays the copy count: the admin dashboard tile already reads it.
        'total_books': total_copies,
        'total_copies': total_copies,
        'total_titles': total_titles,
        'most_issued_books': most_issued_books,
        'total_issued': total_issued,
        'total_overdue': total_overdue,
        'total_categories': total_categories,
        'total_fine_collected': total_fine_collected,
    }


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

        return Response(build_stats_summary(school_id))
