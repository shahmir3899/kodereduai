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
            'parents': {
                'register': '/api/parents/register/',
                'my_children': '/api/parents/my-children/',
                'leave_requests': '/api/parents/leave-requests/',
                'messages': '/api/parents/messages/',
            },
            'admissions': {
                'sessions': '/api/admissions/sessions/',
                'enquiries': '/api/admissions/enquiries/',
                'analytics': '/api/admissions/analytics/pipeline/',
            },
            'lms': {
                'lesson_plans': '/api/lms/lesson-plans/',
                'assignments': '/api/lms/assignments/',
                'submissions': '/api/lms/submissions/',
            },
            'transport': {
                'routes': '/api/transport/routes/',
                'vehicles': '/api/transport/vehicles/',
                'assignments': '/api/transport/assignments/',
                'attendance': '/api/transport/attendance/',
            },
            'library': {
                'categories': '/api/library/categories/',
                'books': '/api/library/books/',
                'issues': '/api/library/issues/',
            },
            'hostel': {
                'hostels': '/api/hostel/hostels/',
                'rooms': '/api/hostel/rooms/',
                'allocations': '/api/hostel/allocations/',
                'gate_passes': '/api/hostel/gate-passes/',
                'dashboard': '/api/hostel/dashboard/',
            },
            'inventory': {
                'categories': '/api/inventory/categories/',
                'vendors': '/api/inventory/vendors/',
                'items': '/api/inventory/items/',
                'assignments': '/api/inventory/assignments/',
                'transactions': '/api/inventory/transactions/',
                'dashboard': '/api/inventory/dashboard/',
            },
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

    # Face Attendance (camera-based)
    path('api/face-attendance/', include('face_attendance.urls')),

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

    # Notifications
    path('api/notifications/', include('notifications.urls')),

    # Reports
    path('api/reports/', include('reports.urls')),

    # Parent Portal
    path('api/parents/', include('parents.urls')),

    # Admission CRM
    path('api/admissions/', include('admissions.urls')),

    # LMS (Lesson Plans & Assignments)
    path('api/lms/', include('lms.urls')),

    # Transportation
    path('api/transport/', include('transport.urls')),

    # Library
    path('api/library/', include('library.urls')),

    # Hostel Management
    path('api/hostel/', include('hostel.urls')),

    # Inventory & Store
    path('api/inventory/', include('inventory.urls')),

    # Background Tasks
    path('api/tasks/', include('core.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
