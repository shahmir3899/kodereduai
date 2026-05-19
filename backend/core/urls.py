from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import AIJobViewSet, BackgroundTaskViewSet
from .ai_views import AIInsightsView

router = DefaultRouter()
router.register('tasks', BackgroundTaskViewSet, basename='background-task')
router.register('ai-jobs', AIJobViewSet, basename='ai-job')

urlpatterns = [
    path('', include(router.urls)),
    path('ai-insights/', AIInsightsView.as_view(), name='ai-insights'),
]
