"""
URL configuration for inventory management app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    InventoryCategoryViewSet, VendorViewSet, InventoryItemViewSet,
    ItemAssignmentViewSet, StockTransactionViewSet, InventoryDashboardView,
    ai_suggest_inventory,
)

router = DefaultRouter()
router.register(r'categories', InventoryCategoryViewSet, basename='inventory-category')
router.register(r'vendors', VendorViewSet, basename='inventory-vendor')
router.register(r'items', InventoryItemViewSet, basename='inventory-item')
router.register(r'assignments', ItemAssignmentViewSet, basename='item-assignment')
router.register(r'transactions', StockTransactionViewSet, basename='stock-transaction')

urlpatterns = [
    path('dashboard/', InventoryDashboardView.as_view(), name='inventory-dashboard'),
    path('ai-suggest/', ai_suggest_inventory, name='inventory-ai-suggest'),
    path('', include(router.urls)),
]
