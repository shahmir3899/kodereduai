"""
Inventory views for categories, vendors, items, assignments, transactions, and dashboard.
"""

from datetime import date

from django.db.models import Sum, Count, Q, F
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes as perm_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id

from .models import InventoryCategory, Vendor, InventoryItem, ItemAssignment, StockTransaction
from .serializers import (
    InventoryCategoryReadSerializer, InventoryCategoryCreateSerializer,
    VendorReadSerializer, VendorCreateSerializer,
    InventoryItemReadSerializer, InventoryItemCreateSerializer,
    ItemAssignmentReadSerializer, ItemAssignmentCreateSerializer,
    StockTransactionReadSerializer, StockTransactionCreateSerializer,
)


# =============================================================================
# Category ViewSet
# =============================================================================

class InventoryCategoryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for inventory categories."""
    required_module = 'inventory'
    queryset = InventoryCategory.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return InventoryCategoryCreateSerializer
        return InventoryCategoryReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('school').annotate(
            items_count=Count('items'),
        )

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset


# =============================================================================
# Vendor ViewSet
# =============================================================================

class VendorViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for vendors/suppliers."""
    required_module = 'inventory'
    queryset = Vendor.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return VendorCreateSerializer
        return VendorReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('school')

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(contact_person__icontains=search),
            )

        return queryset


# =============================================================================
# InventoryItem ViewSet
# =============================================================================

class InventoryItemViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for inventory items.
    Filterable by category_id, is_active, search.
    Custom action: low_stock — returns items below minimum_stock.
    """
    required_module = 'inventory'
    queryset = InventoryItem.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return InventoryItemCreateSerializer
        return InventoryItemReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('school', 'category').annotate(
            active_assignments_count=Count('assignments', filter=Q(assignments__is_active=True)),
        )

        category_id = self.request.query_params.get('category_id')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(sku__icontains=search),
            )

        return queryset

    @action(detail=False, methods=['get'])
    def low_stock(self, request):
        """Return items where current_stock <= minimum_stock."""
        queryset = self.get_queryset().filter(
            current_stock__lte=F('minimum_stock'), is_active=True,
        )
        serializer = InventoryItemReadSerializer(queryset, many=True)
        return Response(serializer.data)


# =============================================================================
# ItemAssignment ViewSet
# =============================================================================

class ItemAssignmentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for item assignments to users.
    On create: auto-creates ISSUE transaction, decreases stock.
    Return action: auto-creates RETURN transaction, increases stock.
    """
    required_module = 'inventory'
    queryset = ItemAssignment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ItemAssignmentCreateSerializer
        return ItemAssignmentReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'item', 'item__category',
            'assigned_to', 'assigned_by',
        )

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        user_id = self.request.query_params.get('user_id')
        if user_id:
            queryset = queryset.filter(assigned_to_id=user_id)

        item_id = self.request.query_params.get('item_id')
        if item_id:
            queryset = queryset.filter(item_id=item_id)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(item__name__icontains=search) |
                Q(assigned_to__username__icontains=search) |
                Q(assigned_to__first_name__icontains=search) |
                Q(assigned_to__last_name__icontains=search),
            )

        return queryset

    def perform_create(self, serializer):
        """Create assignment and auto-create ISSUE stock transaction."""
        assignment = serializer.save(
            school_id=ensure_tenant_school_id(self.request),
            assigned_by=self.request.user,
            is_active=True,
        )

        # Auto-create ISSUE transaction
        StockTransaction.objects.create(
            school_id=assignment.school_id,
            item=assignment.item,
            transaction_type='ISSUE',
            quantity=-assignment.quantity,
            unit_price=assignment.item.unit_price,
            total_amount=assignment.quantity * assignment.item.unit_price,
            assignment=assignment,
            date=assignment.assigned_date,
            recorded_by=self.request.user,
            remarks=f'Assigned to {assignment.assigned_to.username}',
        )

    @action(
        detail=True, methods=['post'], url_path='return',
        permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess],
    )
    def return_item(self, request, pk=None):
        """Mark an assignment as returned. Increases stock back."""
        assignment = self.get_object()

        if not assignment.is_active:
            return Response(
                {'detail': 'This assignment is already returned.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        condition = request.data.get('condition_on_return', 'GOOD')
        notes = request.data.get('notes', '')

        assignment.is_active = False
        assignment.returned_date = date.today()
        assignment.condition_on_return = condition
        if notes:
            assignment.notes = f"{assignment.notes}\nReturn notes: {notes}".strip()
        assignment.save(update_fields=[
            'is_active', 'returned_date', 'condition_on_return', 'notes', 'updated_at',
        ])

        # Auto-create RETURN transaction
        StockTransaction.objects.create(
            school_id=assignment.school_id,
            item=assignment.item,
            transaction_type='RETURN',
            quantity=assignment.quantity,
            unit_price=assignment.item.unit_price,
            total_amount=assignment.quantity * assignment.item.unit_price,
            assignment=assignment,
            date=date.today(),
            recorded_by=request.user,
            remarks=f'Returned by {assignment.assigned_to.username} (condition: {condition})',
        )

        serializer = ItemAssignmentReadSerializer(assignment)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='by-user/(?P<user_id>[^/.]+)')
    def by_user(self, request, user_id=None):
        """Get all assignments for a specific user."""
        queryset = self.get_queryset().filter(assigned_to_id=user_id)
        serializer = ItemAssignmentReadSerializer(queryset, many=True)
        return Response(serializer.data)


# =============================================================================
# StockTransaction ViewSet
# =============================================================================

class StockTransactionViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    List/create stock transactions.
    Transactions are immutable once created (no update/delete).
    """
    required_module = 'inventory'
    queryset = StockTransaction.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    http_method_names = ['get', 'post', 'head', 'options']

    def get_serializer_class(self):
        if self.action == 'create':
            return StockTransactionCreateSerializer
        return StockTransactionReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'item', 'item__category', 'vendor', 'recorded_by', 'assignment',
        )

        item_id = self.request.query_params.get('item_id')
        if item_id:
            queryset = queryset.filter(item_id=item_id)

        transaction_type = self.request.query_params.get('transaction_type')
        if transaction_type:
            queryset = queryset.filter(transaction_type=transaction_type.upper())

        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        return queryset

    def perform_create(self, serializer):
        serializer.save(
            school_id=ensure_tenant_school_id(self.request),
            recorded_by=self.request.user,
        )


# =============================================================================
# Dashboard View
# =============================================================================

class InventoryDashboardView(ModuleAccessMixin, APIView):
    """
    GET: Returns aggregate inventory statistics for the active school.
    """
    required_module = 'inventory'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        items_qs = InventoryItem.objects.filter(school_id=school_id, is_active=True)

        total_items = items_qs.count()

        total_value = sum(
            item.current_stock * item.unit_price for item in items_qs.only(
                'current_stock', 'unit_price',
            )
        )

        low_stock_count = items_qs.filter(
            current_stock__lte=F('minimum_stock'),
        ).count()

        active_assignments = ItemAssignment.objects.filter(
            school_id=school_id, is_active=True,
        ).count()

        total_categories = InventoryCategory.objects.filter(
            school_id=school_id, is_active=True,
        ).count()

        total_vendors = Vendor.objects.filter(
            school_id=school_id, is_active=True,
        ).count()

        recent_transactions = StockTransactionReadSerializer(
            StockTransaction.objects.filter(school_id=school_id).select_related(
                'item', 'vendor', 'recorded_by',
            )[:10],
            many=True,
        ).data

        low_stock_items = InventoryItemReadSerializer(
            items_qs.filter(current_stock__lte=F('minimum_stock'))[:10],
            many=True,
        ).data

        return Response({
            'total_items': total_items,
            'total_value': float(total_value),
            'low_stock_count': low_stock_count,
            'active_assignments': active_assignments,
            'total_categories': total_categories,
            'total_vendors': total_vendors,
            'recent_transactions': recent_transactions,
            'low_stock_items': low_stock_items,
        })


# =============================================================================
# AI Inventory Suggestions
# =============================================================================

@api_view(['POST'])
@perm_classes([IsAuthenticated, HasSchoolAccess])
def ai_suggest_inventory(request):
    """
    Generate AI-powered inventory category and item suggestions.

    POST /api/inventory/ai-suggest/
    Body: { "context": "science lab supplies" }  (optional)
    """
    from .ai_service import suggest_inventory_items
    from schools.models import School

    school_id = ensure_tenant_school_id(request)
    if not school_id:
        return Response(
            {'detail': 'No school associated with your account.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        school = School.objects.get(id=school_id)
    except School.DoesNotExist:
        return Response(
            {'detail': 'School not found.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    user_context = request.data.get('context', '')
    result = suggest_inventory_items(school, user_context)

    return Response(result)
