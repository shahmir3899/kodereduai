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
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
