"""Kuickpay calls these exact paths, case-sensitive, without a trailing slash (guide §1.1). The guide
names the payment path both /api/v1/payment and /api/v1/BillPayment (question K-23), so both are served."""
from django.urls import re_path

from .views import BillInquiryView, BillPaymentView

urlpatterns = [
    re_path(r'^api/v1/BillInquiry/?$', BillInquiryView.as_view(), name='kuickpay-bill-inquiry'),
    re_path(r'^api/v1/(?:BillPayment|payment)/?$', BillPaymentView.as_view(), name='kuickpay-bill-payment'),
]
