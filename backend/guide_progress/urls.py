from rest_framework.routers import DefaultRouter

from .views import GuideProgressViewSet

router = DefaultRouter()
router.register(r'progress', GuideProgressViewSet, basename='guide-progress')

urlpatterns = router.urls
