from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import BackgroundTaskViewSet

router = DefaultRouter()
router.register('tasks', BackgroundTaskViewSet, basename='background-task')

urlpatterns = [
    path('', include(router.urls)),
]
