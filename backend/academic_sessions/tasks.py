"""
Background tasks for academic session operations.
"""

import logging
from django.db import transaction, IntegrityError
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=600)
def bulk_promote_task(self, school_id, source_year_id, target_year_id, promotions, operation_id=None, actor_id=None):
    """Promote students in bulk from one academic year to another."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from academic_sessions.models import StudentEnrollment, PromotionOperation, PromotionEvent
        from students.models import Student

        operation = None
        if operation_id:
            operation = PromotionOperation.objects.filter(id=operation_id, school_id=school_id).first()

        total = len(promotions)
        update_task_progress(task_id, current=0, total=total)

        created = 0
        skipped = []
        errors = []

        for i, promo in enumerate(promotions):
            student_id = promo.get('student_id')
            target_class_id = promo.get('target_class_id')
            target_session_class_id = promo.get('target_session_class_id')
            new_roll_number = promo.get('new_roll_number', '')
            action = promo.get('action', 'PROMOTE')  # PROMOTE, GRADUATE, REPEAT

            try:
                with transaction.atomic():
                    old_enrollment = StudentEnrollment.objects.filter(
                        school_id=school_id,
                        student_id=student_id,
                        academic_year_id=source_year_id,
                        is_active=True,
                    ).first()

                    if not old_enrollment:
                        skipped.append({
                            'student_id': student_id,
                            'reason': 'No active source-year enrollment found.',
                        })
                        if operation:
                            PromotionEvent.objects.create(
                                operation=operation,
                                school_id=school_id,
                                student_id=student_id,
                                source_academic_year_id=source_year_id,
                                target_academic_year_id=target_year_id,
                                event_type=PromotionEvent.EventType.SKIPPED,
                                reason='No active source-year enrollment found.',
                                created_by_id=actor_id,
                            )
                        update_task_progress(task_id, current=i + 1)
                        continue

                    if not new_roll_number:
                        new_roll_number = old_enrollment.roll_number

                    resolved_target_session_class_id = None
                    if action != 'GRADUATE':
                        if target_session_class_id:
                            from academic_sessions.models import SessionClass

                            target_session_class = SessionClass.objects.filter(
                                id=target_session_class_id,
                                school_id=school_id,
                                academic_year_id=target_year_id,
                            ).first()
                            if not target_session_class:
                                raise ValueError('Selected target session class was not found in the target academic year.')
                            if not target_session_class.class_obj_id:
                                raise ValueError('Selected target session class is not linked to a master class.')

                            if target_class_id and target_class_id != target_session_class.class_obj_id:
                                raise ValueError('Target class does not match selected target session class.')

                            target_class_id = target_session_class.class_obj_id
                            resolved_target_session_class_id = target_session_class.id
                        elif old_enrollment.session_class_id and action == 'REPEAT':
                            resolved_target_session_class_id = old_enrollment.session_class_id

                    if action != 'GRADUATE':
                        existing_target = StudentEnrollment.objects.filter(
                            school_id=school_id,
                            student_id=student_id,
                            academic_year_id=target_year_id,
                        ).first()
                        if existing_target:
                            skipped.append({
                                'student_id': student_id,
                                'reason': 'Student already has enrollment in target academic year.',
                                'existing_enrollment_id': existing_target.id,
                            })
                            if operation:
                                PromotionEvent.objects.create(
                                    operation=operation,
                                    school_id=school_id,
                                    student_id=student_id,
                                    source_enrollment=old_enrollment,
                                    target_enrollment=existing_target,
                                    source_academic_year_id=source_year_id,
                                    target_academic_year_id=target_year_id,
                                    source_class_id=old_enrollment.class_obj_id,
                                    target_class_id=existing_target.class_obj_id,
                                    source_session_class_id=old_enrollment.session_class_id,
                                    target_session_class_id=existing_target.session_class_id,
                                    event_type=PromotionEvent.EventType.SKIPPED,
                                    old_status=old_enrollment.status,
                                    new_status=existing_target.status,
                                    old_roll_number=old_enrollment.roll_number,
                                    new_roll_number=existing_target.roll_number,
                                    reason='Student already has enrollment in target academic year.',
                                    created_by_id=actor_id,
                                )
                            update_task_progress(task_id, current=i + 1)
                            continue

                    if action == 'GRADUATE':
                        # Do not create new enrollment, just update statuses
                        previous_status = old_enrollment.status
                        old_enrollment.status = StudentEnrollment.Status.GRADUATED
                        old_enrollment.save(update_fields=['status'])
                        Student.objects.filter(pk=student_id).update(
                            status=Student.Status.GRADUATED,
                        )
                        if operation:
                            PromotionEvent.objects.create(
                                operation=operation,
                                school_id=school_id,
                                student_id=student_id,
                                source_enrollment=old_enrollment,
                                source_academic_year_id=source_year_id,
                                target_academic_year_id=target_year_id,
                                source_class_id=old_enrollment.class_obj_id,
                                source_session_class_id=old_enrollment.session_class_id,
                                event_type=PromotionEvent.EventType.GRADUATED,
                                old_status=previous_status,
                                new_status=StudentEnrollment.Status.GRADUATED,
                                old_roll_number=old_enrollment.roll_number,
                                new_roll_number=old_enrollment.roll_number,
                                details={'action': action},
                                created_by_id=actor_id,
                            )
                    else:
                        from academic_sessions.roll_allocator_service import RollAllocatorService

                        allocator = RollAllocatorService(
                            school_id=school_id,
                            academic_year_id=target_year_id,
                            class_obj_id=target_class_id,
                        )

                        # For PROMOTE or REPEAT, create new enrollment then update source status and student snapshot.
                        for attempt in range(3):
                            try:
                                resolved_roll_number = allocator.resolve_roll(
                                    preferred_roll=new_roll_number,
                                    exclude_student_id=student_id,
                                )

                                new_target = StudentEnrollment.objects.create(
                                    school_id=school_id,
                                    student_id=student_id,
                                    academic_year_id=target_year_id,
                                    session_class_id=resolved_target_session_class_id,
                                    class_obj_id=target_class_id,
                                    roll_number=resolved_roll_number,
                                    status=StudentEnrollment.Status.ACTIVE,
                                )

                                previous_status = old_enrollment.status
                                if action == 'REPEAT':
                                    old_enrollment.status = StudentEnrollment.Status.REPEAT
                                else:
                                    old_enrollment.status = StudentEnrollment.Status.PROMOTED
                                old_enrollment.save(update_fields=['status'])

                                Student.objects.filter(pk=student_id).update(
                                    class_obj_id=target_class_id,
                                    roll_number=resolved_roll_number,
                                    status=Student.Status.REPEAT if action == 'REPEAT' else Student.Status.ACTIVE,
                                )

                                if operation:
                                    PromotionEvent.objects.create(
                                        operation=operation,
                                        school_id=school_id,
                                        student_id=student_id,
                                        source_enrollment=old_enrollment,
                                        target_enrollment=new_target,
                                        source_academic_year_id=source_year_id,
                                        target_academic_year_id=target_year_id,
                                        source_class_id=old_enrollment.class_obj_id,
                                        target_class_id=target_class_id,
                                        source_session_class_id=old_enrollment.session_class_id,
                                        target_session_class_id=resolved_target_session_class_id,
                                        event_type=(
                                            PromotionEvent.EventType.REPEATED
                                            if action == 'REPEAT'
                                            else PromotionEvent.EventType.PROMOTED
                                        ),
                                        old_status=previous_status,
                                        new_status=old_enrollment.status,
                                        old_roll_number=old_enrollment.roll_number,
                                        new_roll_number=resolved_roll_number,
                                        details={'action': action},
                                        created_by_id=actor_id,
                                    )
                                break
                            except IntegrityError:
                                if attempt == 2:
                                    raise
                                continue

                created += 1
            except Exception as e:
                errors.append({'student_id': student_id, 'error': str(e)})
                if operation:
                    PromotionEvent.objects.create(
                        operation=operation,
                        school_id=school_id,
                        student_id=student_id,
                        source_academic_year_id=source_year_id,
                        target_academic_year_id=target_year_id,
                        event_type=PromotionEvent.EventType.FAILED,
                        reason=str(e),
                        details={'action': action},
                        created_by_id=actor_id,
                    )

            update_task_progress(task_id, current=i + 1)

        result_data = {
            'promoted': created,
            'skipped': skipped,
            'errors': errors,
            'operation_id': operation.id if operation else None,
            'message': f'{created} students processed successfully. {len(skipped)} skipped, {len(errors)} failed.',
        }

        if operation:
            if errors and created > 0:
                op_status = PromotionOperation.OperationStatus.PARTIAL
            elif errors and created == 0:
                op_status = PromotionOperation.OperationStatus.FAILED
            else:
                op_status = PromotionOperation.OperationStatus.SUCCESS
            operation.processed_count = created
            operation.skipped_count = len(skipped)
            operation.error_count = len(errors)
            operation.status = op_status
            operation.save(update_fields=['processed_count', 'skipped_count', 'error_count', 'status', 'updated_at'])

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
