from django.contrib import admin
from .models import InventoryCategory, Vendor, InventoryItem, ItemAssignment, StockTransaction


@admin.register(InventoryCategory)
class InventoryCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'is_active')
    list_filter = ('is_active', 'school')
    search_fields = ('name',)


@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'contact_person', 'phone', 'is_active')
    list_filter = ('is_active', 'school')
    search_fields = ('name', 'contact_person')


@admin.register(InventoryItem)
class InventoryItemAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'category', 'current_stock', 'unit', 'unit_price', 'is_active')
    list_filter = ('category', 'is_active', 'school')
    search_fields = ('name', 'sku')


@admin.register(ItemAssignment)
class ItemAssignmentAdmin(admin.ModelAdmin):
    list_display = ('item', 'assigned_to', 'quantity', 'assigned_date', 'is_active')
    list_filter = ('is_active', 'school')
    search_fields = ('item__name', 'assigned_to__username')


@admin.register(StockTransaction)
class StockTransactionAdmin(admin.ModelAdmin):
    list_display = ('item', 'transaction_type', 'quantity', 'total_amount', 'date', 'recorded_by')
    list_filter = ('transaction_type', 'school')
    search_fields = ('item__name', 'reference_number')
