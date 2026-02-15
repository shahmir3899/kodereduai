"""
Inventory serializers with Read (nested details) and Create (flat IDs) pattern.
"""

from rest_framework import serializers
from .models import InventoryCategory, Vendor, InventoryItem, ItemAssignment, StockTransaction


# =============================================================================
# Category Serializers
# =============================================================================

class InventoryCategoryReadSerializer(serializers.ModelSerializer):
    items_count = serializers.IntegerField(source='items.count', read_only=True)

    class Meta:
        model = InventoryCategory
        fields = [
            'id', 'school', 'name', 'description',
            'items_count', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class InventoryCategoryCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryCategory
        fields = ['id', 'name', 'description', 'is_active']
        read_only_fields = ['id']


# =============================================================================
# Vendor Serializers
# =============================================================================

class VendorReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = [
            'id', 'school', 'name', 'contact_person',
            'phone', 'email', 'address',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class VendorCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = [
            'id', 'name', 'contact_person',
            'phone', 'email', 'address', 'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# InventoryItem Serializers
# =============================================================================

class InventoryItemReadSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    unit_display = serializers.CharField(source='get_unit_display', read_only=True)
    is_low_stock = serializers.BooleanField(read_only=True)
    stock_value = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    active_assignments_count = serializers.SerializerMethodField()

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'school',
            'category', 'category_name',
            'name', 'sku', 'unit', 'unit_display',
            'current_stock', 'minimum_stock', 'unit_price',
            'stock_value', 'is_low_stock',
            'location', 'is_active',
            'active_assignments_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_active_assignments_count(self, obj):
        return obj.assignments.filter(is_active=True).count()


class InventoryItemCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryItem
        fields = [
            'id', 'category', 'name', 'sku', 'unit',
            'current_stock', 'minimum_stock', 'unit_price',
            'location', 'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# ItemAssignment Serializers
# =============================================================================

class ItemAssignmentReadSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_unit = serializers.CharField(source='item.get_unit_display', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.username', read_only=True)
    assigned_to_full_name = serializers.SerializerMethodField()
    assigned_by_name = serializers.CharField(
        source='assigned_by.username', read_only=True, default=None,
    )
    condition_on_assign_display = serializers.CharField(
        source='get_condition_on_assign_display', read_only=True,
    )
    condition_on_return_display = serializers.CharField(
        source='get_condition_on_return_display', read_only=True, default=None,
    )

    class Meta:
        model = ItemAssignment
        fields = [
            'id', 'school',
            'item', 'item_name', 'item_unit',
            'assigned_to', 'assigned_to_name', 'assigned_to_full_name',
            'quantity', 'assigned_date', 'returned_date',
            'condition_on_assign', 'condition_on_assign_display',
            'condition_on_return', 'condition_on_return_display',
            'notes',
            'assigned_by', 'assigned_by_name',
            'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'assigned_by', 'returned_date',
            'created_at', 'updated_at',
        ]

    def get_assigned_to_full_name(self, obj):
        user = obj.assigned_to
        full = f"{user.first_name} {user.last_name}".strip()
        return full or user.username


class ItemAssignmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemAssignment
        fields = [
            'id', 'item', 'assigned_to', 'quantity',
            'assigned_date', 'condition_on_assign', 'notes',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        item = attrs.get('item')
        quantity = attrs.get('quantity', 1)

        if item and quantity > item.current_stock:
            raise serializers.ValidationError({
                'quantity': f'Not enough stock. Available: {item.current_stock}, requested: {quantity}.',
            })

        return attrs


# =============================================================================
# StockTransaction Serializers
# =============================================================================

class StockTransactionReadSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_unit = serializers.CharField(source='item.get_unit_display', read_only=True)
    transaction_type_display = serializers.CharField(
        source='get_transaction_type_display', read_only=True,
    )
    vendor_name = serializers.CharField(
        source='vendor.name', read_only=True, default=None,
    )
    recorded_by_name = serializers.CharField(
        source='recorded_by.username', read_only=True, default=None,
    )

    class Meta:
        model = StockTransaction
        fields = [
            'id', 'school',
            'item', 'item_name', 'item_unit',
            'transaction_type', 'transaction_type_display',
            'quantity', 'unit_price', 'total_amount',
            'vendor', 'vendor_name',
            'assignment',
            'reference_number', 'remarks', 'date',
            'recorded_by', 'recorded_by_name',
            'created_at',
        ]
        read_only_fields = ['id', 'recorded_by', 'created_at']


class StockTransactionCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockTransaction
        fields = [
            'id', 'item', 'transaction_type',
            'quantity', 'unit_price',
            'vendor', 'reference_number', 'remarks', 'date',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        tx_type = attrs.get('transaction_type')
        quantity = attrs.get('quantity', 0)

        # Ensure correct sign based on transaction type
        if tx_type in ('PURCHASE', 'RETURN') and quantity < 0:
            raise serializers.ValidationError({
                'quantity': f'{tx_type} transactions must have a positive quantity.',
            })
        if tx_type in ('ISSUE', 'DISPOSAL') and quantity > 0:
            raise serializers.ValidationError({
                'quantity': f'{tx_type} transactions must have a negative quantity.',
            })

        # Check stock for outgoing transactions
        item = attrs.get('item')
        if tx_type in ('ISSUE', 'DISPOSAL') and item:
            if abs(quantity) > item.current_stock:
                raise serializers.ValidationError({
                    'quantity': f'Not enough stock. Available: {item.current_stock}.',
                })

        return attrs
