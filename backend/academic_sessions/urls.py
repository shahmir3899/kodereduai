from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AcademicYearViewSet, TermViewSet, StudentEnrollmentViewSet

router = DefaultRouter()
router.register(r'academic-years', AcademicYearViewSet, basename='academic-year')
router.register(r'terms', TermViewSet, basename='term')
router.register(r'enrollments', StudentEnrollmentViewSet, basename='enrollment')

urlpatterns = [
    path('', include(router.urls)),
]
