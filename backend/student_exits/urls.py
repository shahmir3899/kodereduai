from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import StudentExitViewSet

router = DefaultRouter()
router.register(r'', StudentExitViewSet, basename='student-exit')

urlpatterns = [
    path('', include(router.urls)),
]
