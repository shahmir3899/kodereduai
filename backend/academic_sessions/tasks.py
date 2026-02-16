"""
Background tasks for academic session operations.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=600)
def bulk_promote_task(self, school_id, source_year_id, target_year_id, promotions):
    """Promote students in bulk from one academic year to another."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from academic_sessions.models import StudentEnrollment
        from students.models import Student

        total = len(promotions)
        update_task_progress(task_id, current=0, total=total)

        created = 0
        errors = []

        for i, promo in enumerate(promotions):
            student_id = promo.get('student_id')
            target_class_id = promo.get('target_class_id')
            new_roll_number = promo.get('new_roll_number', '')

            old_enrollment = StudentEnrollment.objects.filter(
                school_id=school_id,
                student_id=student_id,
                academic_year_id=source_year_id,
                is_active=True,
            ).first()

            if old_enrollment:
                old_enrollment.status = StudentEnrollment.Status.PROMOTED
                old_enrollment.save(update_fields=['status'])
                if not new_roll_number:
                    new_roll_number = old_enrollment.roll_number

            try:
                StudentEnrollment.objects.create(
                    school_id=school_id,
                    student_id=student_id,
                    academic_year_id=target_year_id,
                    class_obj_id=target_class_id,
                    roll_number=new_roll_number,
                    status=StudentEnrollment.Status.ACTIVE,
                )
                Student.objects.filter(pk=student_id).update(
                    class_obj_id=target_class_id,
                    roll_number=new_roll_number,
                )
                created += 1
            except Exception as e:
                errors.append({'student_id': student_id, 'error': str(e)})

            update_task_progress(task_id, current=i + 1)

        result_data = {
            'promoted': created,
            'errors': errors,
            'message': f'{created} students promoted successfully.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Bulk promotion failed: {e}")
        mark_task_failed(task_id, str(e))
        raise


@shared_task(bind=True, time_limit=300)
def promotion_advisor_task(self, school_id, academic_year_id, class_id):
    """Run the AI Promotion Advisor analysis."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        update_task_progress(task_id, current=20, total=100)

        from academic_sessions.promotion_advisor_service import PromotionAdvisorService
        service = PromotionAdvisorService(school_id, academic_year_id)
        recommendations = service.get_recommendations(class_id)

        update_task_progress(task_id, current=90, total=100)

        result_data = {
            'recommendations': recommendations,
            'total': len(recommendations),
            'summary': {
                'promote': sum(1 for r in recommendations if r['recommendation'] == 'PROMOTE'),
                'needs_review': sum(1 for r in recommendations if r['recommendation'] == 'NEEDS_REVIEW'),
                'retain': sum(1 for r in recommendations if r['recommendation'] == 'RETAIN'),
            },
            'message': f'Analyzed {len(recommendations)} students.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Promotion advisor failed: {e}")
        mark_task_failed(task_id, str(e))
        raise
