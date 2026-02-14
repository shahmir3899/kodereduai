"""
URL configuration for admissions app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AdmissionSessionViewSet,
    AdmissionEnquiryViewSet,
    AdmissionDocumentViewSet,
    AdmissionNoteViewSet,
    AdmissionAnalyticsView,
    FollowupView,
)

router = DefaultRouter()
router.register(r'sessions', AdmissionSessionViewSet, basename='admission-session')
router.register(r'enquiries', AdmissionEnquiryViewSet, basename='admission-enquiry')

# Nested routers for documents and notes under a specific enquiry
documents_router = DefaultRouter()
documents_router.register(r'', AdmissionDocumentViewSet, basename='admission-document')

notes_router = DefaultRouter()
notes_router.register(r'', AdmissionNoteViewSet, basename='admission-note')

urlpatterns = [
    # Analytics
    path('analytics/pipeline/', AdmissionAnalyticsView.as_view(), name='admission-analytics'),

    # Followups
    path('followups/today/', FollowupView.as_view(), {'followup_type': 'today'}, name='followup-today'),
    path('followups/overdue/', FollowupView.as_view(), {'followup_type': 'overdue'}, name='followup-overdue'),

    # Nested: enquiry documents and notes
    path(
        'enquiries/<int:enquiry_pk>/documents/',
        include((documents_router.urls, 'admission-enquiry-documents')),
    ),
    path(
        'enquiries/<int:enquiry_pk>/notes/',
        include((notes_router.urls, 'admission-enquiry-notes')),
    ),

    # Main router (sessions, enquiries, and their built-in actions)
    path('', include(router.urls)),
]
