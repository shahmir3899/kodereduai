"""
URL configuration for students app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    GradeViewSet, ClassViewSet, StudentViewSet,
    StudentRegistrationView, StudentDashboardView,
    StudentAttendanceView, StudentFeesView, StudentTimetableView,
    StudentResultsView, StudentAssignmentsView, AdminStudentInviteView,
)

router = DefaultRouter()
router.register(r'grades', GradeViewSet, basename='grade')
router.register(r'classes', ClassViewSet, basename='class')
router.register(r'students', StudentViewSet, basename='student')

urlpatterns = [
    # Student Portal endpoints
    path('students/portal/register/', StudentRegistrationView.as_view(), name='student-register'),
    path('students/portal/dashboard/', StudentDashboardView.as_view(), name='student-dashboard'),
    path('students/portal/attendance/', StudentAttendanceView.as_view(), name='student-attendance'),
    path('students/portal/fees/', StudentFeesView.as_view(), name='student-fees'),
    path('students/portal/timetable/', StudentTimetableView.as_view(), name='student-timetable'),
    path('students/portal/results/', StudentResultsView.as_view(), name='student-results'),
    path('students/portal/assignments/', StudentAssignmentsView.as_view(), name='student-assignments'),
    path('students/admin/generate-invite/', AdminStudentInviteView.as_view(), name='student-generate-invite'),

    # Main router
    path('', include(router.urls)),
]
