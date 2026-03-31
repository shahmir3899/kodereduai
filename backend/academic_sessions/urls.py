from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AcademicYearViewSet, TermViewSet, SchoolCalendarEntryViewSet, SessionClassViewSet, StudentEnrollmentViewSet, SessionSetupView, PromotionAdvisorView, SessionHealthView, SectionAllocatorView, AttendanceRiskView

router = DefaultRouter()
router.register(r'academic-years', AcademicYearViewSet, basename='academic-year')
router.register(r'terms', TermViewSet, basename='term')
router.register(r'calendar-entries', SchoolCalendarEntryViewSet, basename='calendar-entry')
router.register(r'session-classes', SessionClassViewSet, basename='session-class')
router.register(r'enrollments', StudentEnrollmentViewSet, basename='enrollment')

urlpatterns = [
    path('', include(router.urls)),
    path('promotion-advisor/', PromotionAdvisorView.as_view(), name='promotion-advisor'),
    path('setup-wizard/', SessionSetupView.as_view(), name='session-setup-wizard'),
    path('health/', SessionHealthView.as_view(), name='session-health'),
    path('section-allocator/', SectionAllocatorView.as_view(), name='section-allocator'),
    path('attendance-risk/', AttendanceRiskView.as_view(), name='attendance-risk'),
]
