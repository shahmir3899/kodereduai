"""
URL configuration for KoderEduAI.pk Platform.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny


@api_view(['GET'])
@permission_classes([AllowAny])
def api_root(request):
    """API root endpoint with available endpoints."""
    return Response({
        'name': 'KoderEduAI API',
        'version': '1.0.0',
        'endpoints': {
            'auth': {
                'login': '/api/auth/login/',
                'refresh': '/api/auth/refresh/',
                'me': '/api/auth/me/',
                'change_password': '/api/auth/change-password/',
            },
            'schools': '/api/schools/',
            'classes': '/api/classes/',
            'students': '/api/students/',
            'attendance': {
                'uploads': '/api/attendance/uploads/',
                'records': '/api/attendance/records/',
            },
            'finance': {
                'fee_structures': '/api/finance/fee-structures/',
                'fee_payments': '/api/finance/fee-payments/',
                'expenses': '/api/finance/expenses/',
                'reports': '/api/finance/reports/',
                'ai_chat': '/api/finance/ai-chat/',
            },
            'hr': {
                'staff': '/api/hr/staff/',
                'departments': '/api/hr/departments/',
                'designations': '/api/hr/designations/',
                'dashboard_stats': '/api/hr/staff/dashboard_stats/',
            },
            'academics': {
                'subjects': '/api/academics/subjects/',
                'class_subjects': '/api/academics/class-subjects/',
                'timetable_slots': '/api/academics/timetable-slots/',
                'timetable_entries': '/api/academics/timetable-entries/',
            },
            'sessions': {
                'academic_years': '/api/sessions/academic-years/',
                'terms': '/api/sessions/terms/',
                'enrollments': '/api/sessions/enrollments/',
            },
            'examinations': {
                'exam_types': '/api/examinations/exam-types/',
                'exams': '/api/examinations/exams/',
                'exam_subjects': '/api/examinations/exam-subjects/',
                'marks': '/api/examinations/marks/',
                'grade_scales': '/api/examinations/grade-scales/',
                'report_card': '/api/examinations/report-card/',
            },
            'grades': '/api/grades/',
            'admin': {
                'schools': '/api/admin/schools/',
            }
        }
    })


urlpatterns = [
    # Django Admin
    path('admin/', admin.site.urls),

    # API Root
    path('api/', api_root, name='api-root'),

    # Authentication & Users
    path('api/', include('users.urls')),

    # Schools (includes admin endpoints)
    path('api/', include('schools.urls')),

    # Students & Classes
    path('api/', include('students.urls')),

    # Attendance
    path('api/attendance/', include('attendance.urls')),

    # Finance
    path('api/finance/', include('finance.urls')),

    # HR & Staff Management
    path('api/hr/', include('hr.urls')),

    # Academics (Subjects & Timetable)
    path('api/academics/', include('academics.urls')),

    # Academic Sessions
    path('api/sessions/', include('academic_sessions.urls')),

    # Examinations & Results
    path('api/examinations/', include('examinations.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
