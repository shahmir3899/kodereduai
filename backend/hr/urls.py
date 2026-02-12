from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    StaffDepartmentViewSet, StaffDesignationViewSet, StaffMemberViewSet,
    SalaryStructureViewSet, PayslipViewSet,
    LeavePolicyViewSet, LeaveApplicationViewSet,
    StaffAttendanceViewSet, PerformanceAppraisalViewSet,
    StaffQualificationViewSet, StaffDocumentViewSet,
)

router = DefaultRouter()
router.register(r'departments', StaffDepartmentViewSet, basename='staff-department')
router.register(r'designations', StaffDesignationViewSet, basename='staff-designation')
router.register(r'staff', StaffMemberViewSet, basename='staff-member')
router.register(r'salary-structures', SalaryStructureViewSet, basename='salary-structure')
router.register(r'payslips', PayslipViewSet, basename='payslip')
router.register(r'leave-policies', LeavePolicyViewSet, basename='leave-policy')
router.register(r'leave-applications', LeaveApplicationViewSet, basename='leave-application')
router.register(r'attendance', StaffAttendanceViewSet, basename='staff-attendance')
router.register(r'appraisals', PerformanceAppraisalViewSet, basename='performance-appraisal')
router.register(r'qualifications', StaffQualificationViewSet, basename='staff-qualification')
router.register(r'documents', StaffDocumentViewSet, basename='staff-document')

urlpatterns = [
    path('', include(router.urls)),
]
