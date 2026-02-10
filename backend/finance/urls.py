"""
URL configuration for finance app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AccountViewSet, TransferViewSet,
    FeeStructureViewSet, FeePaymentViewSet, ExpenseViewSet,
    OtherIncomeViewSet, FinanceReportsView, FinanceAIChatView,
)

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'transfers', TransferViewSet, basename='transfer')
router.register(r'fee-structures', FeeStructureViewSet, basename='fee-structure')
router.register(r'fee-payments', FeePaymentViewSet, basename='fee-payment')
router.register(r'expenses', ExpenseViewSet, basename='expense')
router.register(r'other-income', OtherIncomeViewSet, basename='other-income')

urlpatterns = [
    path('reports/', FinanceReportsView.as_view(), name='finance-reports'),
    path('ai-chat/', FinanceAIChatView.as_view(), name='finance-ai-chat'),
    path('', include(router.urls)),
]
