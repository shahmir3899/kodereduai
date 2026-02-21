from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import BackgroundTaskViewSet
from .ai_views import AIInsightsView

router = DefaultRouter()
router.register('tasks', BackgroundTaskViewSet, basename='background-task')

urlpatterns = [
    path('', include(router.urls)),
    path('ai-insights/', AIInsightsView.as_view(), name='ai-insights'),
]
