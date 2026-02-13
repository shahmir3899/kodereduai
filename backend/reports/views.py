"""
Report generation views.
"""

import base64
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.http import HttpResponse

from core.permissions import IsSchoolAdmin, HasSchoolAccess
from core.mixins import ensure_tenant_school_id
from .serializers import GenerateReportSerializer
from .models import GeneratedReport


GENERATOR_MAP = {
    'ATTENDANCE_DAILY': 'reports.generators.attendance.DailyAttendanceReportGenerator',
    'ATTENDANCE_MONTHLY': 'reports.generators.attendance.MonthlyAttendanceReportGenerator',
    'FEE_COLLECTION': 'reports.generators.fee.FeeCollectionReportGenerator',
    'FEE_DEFAULTERS': 'reports.generators.fee.FeeDefaultersReportGenerator',
    'CLASS_RESULT': 'reports.generators.academic.ClassResultReportGenerator',
    'STUDENT_PROGRESS': 'reports.generators.academic.StudentProgressReportGenerator',
    'STUDENT_COMPREHENSIVE': 'reports.generators.student.StudentComprehensiveReportGenerator',
}


def _get_generator_class(report_type):
    path = GENERATOR_MAP.get(report_type)
    if not path:
        return None
    module_path, class_name = path.rsplit('.', 1)
    import importlib
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


class GenerateReportView(APIView):
    """Generate a report and return it as a downloadable file."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request):
        serializer = GenerateReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from schools.models import School
        school = School.objects.get(id=school_id)

        generator_class = _get_generator_class(data['report_type'])
        if not generator_class:
            return Response({'error': f"Unknown report type: {data['report_type']}"}, status=400)

        generator = generator_class(school, data.get('parameters', {}))
        fmt = data.get('format', 'PDF')
        content = generator.generate(format=fmt)

        # Save record
        report = GeneratedReport.objects.create(
            school=school,
            report_type=data['report_type'],
            title=f"{data['report_type']} Report",
            parameters=data.get('parameters', {}),
            format=fmt,
            generated_by=request.user,
        )

        # Return as downloadable file
        if fmt == 'XLSX':
            response = HttpResponse(
                content,
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
            response['Content-Disposition'] = f'attachment; filename="report_{report.id}.xlsx"'
        else:
            content_type = 'application/pdf' if content[:4] == b'%PDF' else 'text/plain'
            response = HttpResponse(content, content_type=content_type)
            response['Content-Disposition'] = f'attachment; filename="report_{report.id}.pdf"'

        return response


class ReportListView(APIView):
    """List previously generated reports."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from .serializers import GeneratedReportSerializer
        reports = GeneratedReport.objects.filter(
            school_id=school_id
        ).order_by('-created_at')[:50]

        return Response(GeneratedReportSerializer(reports, many=True).data)
