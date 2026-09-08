"""
URL configuration for students app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ClassViewSet, StudentViewSet,
    StudentRegistrationView, StudentDashboardView, StudentProfileView,
    StudentAttendanceView, StudentFeesView, StudentTimetableView,
    StudentExamScheduleView,
    StudentResultsView, StudentAssignmentsView, AdminStudentInviteView,
    StudyHelperView,
)

router = DefaultRouter()
router.register(r'classes', ClassViewSet, basename='class')
router.register(r'students', StudentViewSet, basename='student')

urlpatterns = [
    # Student Portal endpoints
    path('students/portal/register/', StudentRegistrationView.as_view(), name='student-register'),
    path('students/portal/dashboard/', StudentDashboardView.as_view(), name='student-dashboard'),
    path('students/portal/profile/', StudentProfileView.as_view(), name='student-profile'),
    path('students/portal/attendance/', StudentAttendanceView.as_view(), name='student-attendance'),
    path('students/portal/fees/', StudentFeesView.as_view(), name='student-fees'),
    path('students/portal/timetable/', StudentTimetableView.as_view(), name='student-timetable'),
    path('students/portal/exam-schedule/', StudentExamScheduleView.as_view(), name='student-exam-schedule'),
    path('students/portal/results/', StudentResultsView.as_view(), name='student-results'),
    path('students/portal/assignments/', StudentAssignmentsView.as_view(), name='student-assignments'),
    path('students/admin/generate-invite/', AdminStudentInviteView.as_view(), name='student-generate-invite'),
    path('students/portal/study-helper/', StudyHelperView.as_view(), name='student-study-helper'),

    # Main router
    path('', include(router.urls)),
]
