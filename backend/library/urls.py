"""
URL configuration for library app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    BookCategoryViewSet,
    BookViewSet,
    BookIssueViewSet,
    LibraryConfigViewSet,
    LibraryStatsView,
)

router = DefaultRouter()
router.register(r'categories', BookCategoryViewSet, basename='book-category')
router.register(r'books', BookViewSet, basename='book')
router.register(r'issues', BookIssueViewSet, basename='book-issue')

urlpatterns = [
    path('config/', LibraryConfigViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update'}), name='library-config'),
    path('stats/', LibraryStatsView.as_view(), name='library-stats'),
    path('', include(router.urls)),
]
