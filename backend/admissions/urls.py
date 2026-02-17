"""
URL configuration for admissions app (simplified).
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AdmissionEnquiryViewSet,
    AdmissionNoteViewSet,
    FollowupView,
)

router = DefaultRouter()
router.register(r'enquiries', AdmissionEnquiryViewSet, basename='admission-enquiry')

notes_router = DefaultRouter()
notes_router.register(r'', AdmissionNoteViewSet, basename='admission-note')

urlpatterns = [
    # Followups
    path('followups/today/', FollowupView.as_view(), {'followup_type': 'today'}, name='followup-today'),
    path('followups/overdue/', FollowupView.as_view(), {'followup_type': 'overdue'}, name='followup-overdue'),

    # Nested: enquiry notes
    path(
        'enquiries/<int:enquiry_pk>/notes/',
        include((notes_router.urls, 'admission-enquiry-notes')),
    ),

    # Main router (enquiries + built-in actions: update-status, batch-convert)
    path('', include(router.urls)),
]
