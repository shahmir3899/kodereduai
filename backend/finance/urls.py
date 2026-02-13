"""
URL configuration for finance app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AccountViewSet, TransferViewSet,
    FeeStructureViewSet, FeePaymentViewSet, ExpenseViewSet,
    OtherIncomeViewSet, FinanceReportsView, FinanceAIChatView,
    FeePredictorView,
    DiscountViewSet, ScholarshipViewSet, StudentDiscountViewSet,
    PaymentGatewayConfigViewSet, OnlinePaymentViewSet,
    FeeBreakdownView, SiblingDetectionView,
)

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'transfers', TransferViewSet, basename='transfer')
router.register(r'fee-structures', FeeStructureViewSet, basename='fee-structure')
router.register(r'fee-payments', FeePaymentViewSet, basename='fee-payment')
router.register(r'expenses', ExpenseViewSet, basename='expense')
router.register(r'other-income', OtherIncomeViewSet, basename='other-income')
router.register(r'discounts', DiscountViewSet, basename='discount')
router.register(r'scholarships', ScholarshipViewSet, basename='scholarship')
router.register(r'student-discounts', StudentDiscountViewSet, basename='student-discount')
router.register(r'gateway-config', PaymentGatewayConfigViewSet, basename='gateway-config')
router.register(r'online-payments', OnlinePaymentViewSet, basename='online-payment')

urlpatterns = [
    path('reports/', FinanceReportsView.as_view(), name='finance-reports'),
    path('ai-chat/', FinanceAIChatView.as_view(), name='finance-ai-chat'),
    path('fee-predictor/', FeePredictorView.as_view(), name='fee-predictor'),
    path('fee-breakdown/<int:student_id>/', FeeBreakdownView.as_view(), name='fee-breakdown'),
    path('siblings/<int:student_id>/', SiblingDetectionView.as_view(), name='sibling-detection'),
    path('', include(router.urls)),
]
