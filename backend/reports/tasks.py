"""
Background tasks for report generation.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=1, time_limit=600)
def generate_report_task(self, school_id, user_id, report_type, format, parameters):
    """Generate a report asynchronously and store the result."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        update_task_progress(task_id, current=0, total=3)

        # Step 1: Load generator
        from reports.views import _get_generator_class
        from schools.models import School

        school = School.objects.get(id=school_id)
        generator_class = _get_generator_class(report_type)
        if not generator_class:
            mark_task_failed(task_id, f"Unknown report type: {report_type}")
            return {'success': False, 'error': f"Unknown report type: {report_type}"}

        update_task_progress(task_id, current=1)

        # Step 2: Generate content
        generator = generator_class(school, parameters)
        content = generator.generate(format=format)

        update_task_progress(task_id, current=2)

        # Step 3: Save report record
        from reports.models import GeneratedReport
        from django.contrib.auth import get_user_model
        User = get_user_model()

        report = GeneratedReport.objects.create(
            school=school,
            report_type=report_type,
            title=f"{report_type.replace('_', ' ').title()} Report",
            parameters=parameters,
            format=format,
            file_content=content,
            generated_by=User.objects.get(id=user_id),
        )

        result_data = {
            'report_id': report.id,
            'report_type': report_type,
            'format': format,
            'download_url': f'/api/reports/{report.id}/download/',
            'message': f'{report_type.replace("_", " ").title()} report generated.',
        }

        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Report generation failed: {e}")
        mark_task_failed(task_id, str(e))
        raise
