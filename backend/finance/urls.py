"""
URL configuration for finance app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AccountViewSet, TransferViewSet,
    FeeStructureViewSet, FeePaymentViewSet,
    ExpenseCategoryViewSet, IncomeCategoryViewSet, AnnualFeeCategoryViewSet, MonthlyFeeCategoryViewSet,
    ExpenseViewSet, OtherIncomeViewSet,
    FinanceReportsView, FinanceAIChatView,
    FeePredictorView,
    DiscountViewSet, ScholarshipViewSet, StudentDiscountViewSet,
    PaymentGatewayConfigViewSet, OnlinePaymentViewSet,
    FeeBreakdownView,
    JazzCashCallbackView, EasypaisaCallbackView, PaymentStatusView,
)

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'transfers', TransferViewSet, basename='transfer')
router.register(r'fee-structures', FeeStructureViewSet, basename='fee-structure')
router.register(r'fee-payments', FeePaymentViewSet, basename='fee-payment')
router.register(r'expense-categories', ExpenseCategoryViewSet, basename='expense-category')
router.register(r'income-categories', IncomeCategoryViewSet, basename='income-category')
router.register(r'annual-categories', AnnualFeeCategoryViewSet, basename='annual-category')
router.register(r'monthly-categories', MonthlyFeeCategoryViewSet, basename='monthly-category')
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
    # Payment gateway callbacks (public — no auth, verified by signature)
    path('callbacks/jazzcash/', JazzCashCallbackView.as_view(), name='jazzcash-callback'),
    path('callbacks/easypaisa/', EasypaisaCallbackView.as_view(), name='easypaisa-callback'),

    # Payment status check
    path('payment-status/<str:order_id>/', PaymentStatusView.as_view(), name='payment-status'),

    path('', include(router.urls)),
]
