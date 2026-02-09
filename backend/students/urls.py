"""
URL configuration for students app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import ClassViewSet, StudentViewSet

router = DefaultRouter()
router.register(r'classes', ClassViewSet, basename='class')
router.register(r'students', StudentViewSet, basename='student')

urlpatterns = [
    path('', include(router.urls)),
]
