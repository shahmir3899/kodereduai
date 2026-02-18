"""
Report generation views.
"""

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
    """Generate a report as a background task."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request):
        serializer = GenerateReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        generator_class = _get_generator_class(data['report_type'])
        if not generator_class:
            return Response({'error': f"Unknown report type: {data['report_type']}"}, status=400)

        from core.models import BackgroundTask
        from .tasks import generate_report_task

        fmt = data.get('format', 'PDF')
        report_label = data['report_type'].replace('_', ' ').title()
        title = f"Generating {report_label} ({fmt})"

        task_kwargs = {
            'school_id': school_id,
            'user_id': request.user.id,
            'report_type': data['report_type'],
            'format': fmt,
            'parameters': data.get('parameters', {}),
        }

        if fmt == 'XLSX':
            # XLSX generation is fast — run synchronously
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    generate_report_task, BackgroundTask.TaskType.REPORT_GENERATION,
                    title, school_id, request.user,
                    task_kwargs=task_kwargs, progress_total=3,
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', f'{report_label} report generated.') if bg_task.result_data else f'{report_label} report generated.',
                'result': bg_task.result_data,
            })
        else:
            # PDF generation is slow — use async
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=generate_report_task,
                task_type=BackgroundTask.TaskType.REPORT_GENERATION,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs, progress_total=3,
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': f'{report_label} report generation started.',
            }, status=202)


class ReportDownloadView(APIView):
    """Download a previously generated report by ID."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request, report_id):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        try:
            report = GeneratedReport.objects.get(id=report_id, school_id=school_id)
        except GeneratedReport.DoesNotExist:
            return Response({'error': 'Report not found'}, status=404)

        if not report.file_content:
            return Response({'error': 'Report content not available'}, status=404)

        content = bytes(report.file_content)

        if report.format == 'XLSX':
            content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ext = 'xlsx'
        else:
            content_type = 'application/pdf'
            ext = 'pdf'

        response = HttpResponse(content, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="report_{report.id}.{ext}"'
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
