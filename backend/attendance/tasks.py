"""
Celery tasks for attendance processing.
"""

import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_attendance_upload(self, upload_id: int):
    """
    Process an attendance upload through the AI pipeline.

    New Pipeline (Image → OCR → Structured Table → LLM Reasoning):
    1. OCR with Tesseract - extract text with confidence scores
    2. Table Extraction - build structured table from OCR output
    3. LLM Reasoning - validate and reason on structured data
    4. Student Matching - match to enrolled students
    5. Update upload with results for human review

    Args:
        upload_id: ID of the AttendanceUpload to process
    """
    from .models import AttendanceUpload
    from .attendance_processor import AttendanceProcessor

    try:
        upload = AttendanceUpload.objects.get(id=upload_id)
    except AttendanceUpload.DoesNotExist:
        logger.error(f"AttendanceUpload {upload_id} not found")
        return {'success': False, 'error': 'Upload not found'}

    logger.info(f"Processing attendance upload {upload_id} for {upload.class_obj.name}")

    try:
        processor = AttendanceProcessor(upload)
        result = processor.process()

        if result.success:
            # Update upload with results
            upload.ai_output_json = result.to_ai_output_json()
            upload.confidence_score = result.confidence
            upload.status = AttendanceUpload.Status.REVIEW_REQUIRED
            upload.save()

            logger.info(
                f"Upload {upload_id} processed successfully. "
                f"Matched: {result.matched_count}, "
                f"Unmatched: {result.unmatched_count}, "
                f"Uncertain: {len(result.uncertain)}"
            )

            return {
                'success': True,
                'upload_id': upload_id,
                'matched_count': result.matched_count,
                'unmatched_count': result.unmatched_count,
                'uncertain_count': len(result.uncertain),
                'confidence': result.confidence,
                'pipeline_stages': result.pipeline_stages
            }
        else:
            # Processing failed
            upload.status = AttendanceUpload.Status.FAILED
            upload.error_message = f"[{result.error_stage}] {result.error}"
            upload.save()

            logger.error(f"Upload {upload_id} processing failed: {upload.error_message}")

            return {
                'success': False,
                'upload_id': upload_id,
                'error': upload.error_message,
                'error_stage': result.error_stage
            }

    except Exception as e:
        logger.exception(f"Error processing upload {upload_id}")

        # Update upload status on error
        try:
            upload.status = AttendanceUpload.Status.FAILED
            upload.error_message = str(e)
            upload.save()
        except Exception:
            pass

        # Retry the task
        raise self.retry(exc=e)


@shared_task
def send_whatsapp_notifications(upload_id: int):
    """
    Send WhatsApp notifications to parents of absent students.

    This task runs ONLY after attendance is confirmed.

    Args:
        upload_id: ID of the confirmed AttendanceUpload
    """
    from .models import AttendanceUpload, AttendanceRecord
    from .services import WhatsAppService

    try:
        upload = AttendanceUpload.objects.get(
            id=upload_id,
            status=AttendanceUpload.Status.CONFIRMED
        )
    except AttendanceUpload.DoesNotExist:
        logger.error(f"Confirmed AttendanceUpload {upload_id} not found")
        return {'success': False, 'error': 'Upload not found or not confirmed'}

    # Get absent records that haven't been notified yet
    absent_records = AttendanceRecord.objects.filter(
        upload=upload,
        status=AttendanceRecord.AttendanceStatus.ABSENT,
        notification_sent=False
    ).select_related('student', 'student__class_obj')

    if not absent_records.exists():
        logger.info(f"No notifications to send for upload {upload_id}")
        return {'success': True, 'sent': 0, 'failed': 0}

    # Send notifications
    whatsapp_service = WhatsAppService(upload.school)

    if not whatsapp_service.is_configured():
        logger.warning(f"WhatsApp not configured for school {upload.school.name}")
        return {'success': False, 'error': 'WhatsApp not configured'}

    result = whatsapp_service.send_bulk_notifications(list(absent_records))

    logger.info(
        f"WhatsApp notifications for upload {upload_id}: "
        f"Sent: {result['sent']}, Failed: {result['failed']}"
    )

    return {
        'success': True,
        'upload_id': upload_id,
        'sent': result['sent'],
        'failed': result['failed']
    }


@shared_task
def cleanup_old_uploads(days: int = 90):
    """
    Clean up old failed uploads to save storage.

    Args:
        days: Delete failed uploads older than this many days
    """
    from .models import AttendanceUpload

    cutoff_date = timezone.now() - timezone.timedelta(days=days)

    deleted_count, _ = AttendanceUpload.objects.filter(
        status=AttendanceUpload.Status.FAILED,
        created_at__lt=cutoff_date
    ).delete()

    logger.info(f"Cleaned up {deleted_count} old failed uploads")

    return {'deleted_count': deleted_count}


@shared_task
def retry_failed_uploads(hours: int = 24):
    """
    Retry failed uploads that failed within the last N hours.

    Args:
        hours: Retry uploads that failed within this many hours
    """
    from .models import AttendanceUpload

    cutoff_time = timezone.now() - timezone.timedelta(hours=hours)

    failed_uploads = AttendanceUpload.objects.filter(
        status=AttendanceUpload.Status.FAILED,
        updated_at__gte=cutoff_time
    )

    retried = 0
    for upload in failed_uploads:
        upload.status = AttendanceUpload.Status.PROCESSING
        upload.error_message = ''
        upload.save()

        process_attendance_upload.delay(upload.id)
        retried += 1

    logger.info(f"Retried {retried} failed uploads")

    return {'retried_count': retried}


@shared_task
def auto_tune_thresholds():
    """
    Weekly auto-tuning of AI thresholds based on human correction patterns.

    For each school with auto_tune_enabled:
    - Reads 14-day accuracy stats from LearningService
    - Adjusts thresholds that are causing excessive errors
    - Saves updated thresholds and records tune history
    """
    from schools.models import School
    from .learning_service import LearningService
    from .threshold_service import ThresholdService
    import json

    schools = School.objects.filter(
        is_active=True,
        ai_config__auto_tune_enabled=True,
    )

    results = []
    for school in schools:
        try:
            learning = LearningService(school)
            stats = learning.get_school_accuracy_stats(days=14)
            total_predictions = stats.get('total_predictions', 0)

            if total_predictions < 50:
                results.append({
                    'school_id': school.id,
                    'skipped': True,
                    'reason': f'Not enough data ({total_predictions} predictions, need 50)',
                })
                continue

            ai_config = school.ai_config or {}
            thresholds = dict(ai_config.get('thresholds', {}))
            changes = []

            # --- Fuzzy name match threshold ---
            name_mismatches = stats.get('name_mismatches', 0)
            name_mismatch_rate = name_mismatches / total_predictions

            if name_mismatch_rate > 0.05:
                old = thresholds.get('fuzzy_name_match', 0.45)
                new = min(old + 0.05, 0.7)
                if new != old:
                    thresholds['fuzzy_name_match'] = round(new, 2)
                    changes.append(f'fuzzy_name_match {old} -> {new:.2f} (name mismatch rate {name_mismatch_rate:.1%})')
            elif name_mismatches == 0 and total_predictions > 100:
                old = thresholds.get('fuzzy_name_match', 0.45)
                new = max(old - 0.02, 0.3)
                if new != old:
                    thresholds['fuzzy_name_match'] = round(new, 2)
                    changes.append(f'fuzzy_name_match {old} -> {new:.2f} (zero mismatches, relaxing)')

            # --- High confidence threshold ---
            fp_count = stats.get('false_positives', 0)
            fp_rate = fp_count / total_predictions

            if fp_rate > 0.10:
                old = thresholds.get('high_confidence', 0.8)
                new = min(old + 0.05, 0.95)
                if new != old:
                    thresholds['high_confidence'] = round(new, 2)
                    changes.append(f'high_confidence {old} -> {new:.2f} (FP rate {fp_rate:.1%})')

            # --- Uncertain threshold ---
            fn_count = stats.get('false_negatives', 0)
            fn_rate = fn_count / total_predictions

            if fn_rate > 0.10:
                old = thresholds.get('uncertain_threshold', 0.6)
                new = max(old - 0.05, 0.3)
                if new != old:
                    thresholds['uncertain_threshold'] = round(new, 2)
                    changes.append(f'uncertain_threshold {old} -> {new:.2f} (FN rate {fn_rate:.1%})')

            if changes:
                ai_config['thresholds'] = thresholds
                ai_config['last_tuned_at'] = timezone.now().isoformat()

                # Keep last 12 tune history entries
                history = ai_config.get('tune_history', [])
                history.append({
                    'date': timezone.now().isoformat(),
                    'changes': changes,
                    'stats': {
                        'total_predictions': total_predictions,
                        'accuracy': stats.get('accuracy'),
                        'false_positives': fp_count,
                        'false_negatives': fn_count,
                        'name_mismatches': name_mismatches,
                    },
                })
                ai_config['tune_history'] = history[-12:]

                school.ai_config = ai_config
                school.save(update_fields=['ai_config'])

                logger.info(f"[AutoTune] School {school.id}: {changes}")
            else:
                logger.info(f"[AutoTune] School {school.id}: no changes needed")

            results.append({
                'school_id': school.id,
                'changes': changes,
                'total_predictions': total_predictions,
                'accuracy': stats.get('accuracy'),
            })

        except Exception as e:
            logger.exception(f"[AutoTune] Error for school {school.id}: {e}")
            results.append({
                'school_id': school.id,
                'error': str(e),
            })

    logger.info(f"[AutoTune] Processed {len(results)} schools")
    return {'schools_processed': len(results), 'results': results}


@shared_task
def detect_accuracy_drift():
    """
    Daily drift detection: compares yesterday's accuracy to 30-day baseline.
    Creates AccuracySnapshot records and alerts admins when accuracy drops.
    """
    from schools.models import School
    from .models import AccuracySnapshot, AttendanceFeedback, AttendanceUpload
    from .learning_service import LearningService, CorrectionType
    from datetime import timedelta

    yesterday = (timezone.now() - timezone.timedelta(days=1)).date()
    schools = School.objects.filter(is_active=True)
    results = []

    for school in schools:
        try:
            learning = LearningService(school)

            # Get yesterday's stats
            day_start = timezone.make_aware(
                timezone.datetime.combine(yesterday, timezone.datetime.min.time())
            )
            day_end = day_start + timedelta(days=1)

            day_feedbacks = AttendanceFeedback.objects.filter(
                school=school, created_at__gte=day_start, created_at__lt=day_end,
            )
            day_corrections = day_feedbacks.count()

            # Count predictions from yesterday's confirmed uploads
            day_uploads = AttendanceUpload.objects.filter(
                school=school, created_at__gte=day_start, created_at__lt=day_end,
                status='CONFIRMED',
            )
            day_predictions = 0
            for u in day_uploads:
                if u.ai_output_json:
                    day_predictions += len(u.ai_output_json.get('matched', []))
                    day_predictions += len(u.ai_output_json.get('present', []))

            if day_predictions < 5:
                continue  # Not enough data

            fp = day_feedbacks.filter(correction_type=CorrectionType.FALSE_POSITIVE).count()
            fn = day_feedbacks.filter(correction_type=CorrectionType.FALSE_NEGATIVE).count()
            nm = day_feedbacks.filter(correction_type=CorrectionType.NAME_MISMATCH).count()

            att_corrections = fp + fn
            day_accuracy = 1 - (att_corrections / day_predictions) if day_predictions else None

            # Get 30-day baseline
            baseline_stats = learning.get_school_accuracy_stats(days=30)
            baseline_accuracy = baseline_stats.get('accuracy')

            # Detect drift: >10 percentage point drop from baseline
            drift = False
            drift_details = {}
            if baseline_accuracy is not None and day_accuracy is not None:
                drop = baseline_accuracy - day_accuracy
                if drop > 0.10:
                    drift = True
                    drift_details = {
                        'baseline_accuracy': round(baseline_accuracy, 3),
                        'day_accuracy': round(day_accuracy, 3),
                        'drop': round(drop, 3),
                        'message': f'Accuracy dropped from {baseline_accuracy:.0%} to {day_accuracy:.0%}',
                    }

            # Save snapshot (upsert)
            snapshot, _ = AccuracySnapshot.objects.update_or_create(
                school=school, date=yesterday,
                defaults={
                    'total_predictions': day_predictions,
                    'total_corrections': day_corrections,
                    'false_positives': fp,
                    'false_negatives': fn,
                    'name_mismatches': nm,
                    'accuracy': day_accuracy,
                    'drift_detected': drift,
                    'drift_details': drift_details,
                },
            )

            # Alert admins if drift detected
            if drift:
                try:
                    from notifications.triggers import trigger_general
                    trigger_general(
                        school=school,
                        title='AI Accuracy Drift Detected',
                        body=(
                            f"Attendance AI accuracy dropped from {baseline_accuracy:.0%} "
                            f"to {day_accuracy:.0%} on {yesterday}. "
                            f"Review recent uploads and consider adjusting thresholds."
                        ),
                        recipient_type='ADMIN',
                    )
                except Exception as e:
                    logger.warning(f"[Drift] Failed to send alert for school {school.id}: {e}")

            results.append({
                'school_id': school.id,
                'accuracy': day_accuracy,
                'drift': drift,
            })

        except Exception as e:
            logger.exception(f"[Drift] Error for school {school.id}: {e}")

    logger.info(f"[Drift] Processed {len(results)} schools, "
                f"{sum(1 for r in results if r.get('drift'))} drifts detected")
    return {'schools_processed': len(results), 'results': results}


@shared_task
def detect_attendance_anomalies():
    """
    Daily anomaly detection for attendance patterns.

    Detections:
    1. Bulk class absence: >60% absent in any class
    2. Student streak: 3+ consecutive days absent
    3. Unusual school day: school-wide absence >30%
    """
    from schools.models import School
    from students.models import Student, Class
    from .models import AttendanceRecord, AttendanceAnomaly
    from datetime import timedelta

    yesterday = (timezone.now() - timezone.timedelta(days=1)).date()
    schools = School.objects.filter(is_active=True)
    total_anomalies = 0

    for school in schools:
        try:
            # 1. Bulk class absence (>60% of enrolled students absent)
            classes = Class.objects.filter(school=school, is_active=True)
            for cls in classes:
                enrolled = Student.objects.filter(
                    school=school, class_obj=cls, is_active=True,
                ).count()
                if enrolled < 5:
                    continue

                absent = AttendanceRecord.objects.filter(
                    school=school,
                    student__class_obj=cls,
                    date=yesterday,
                    status='ABSENT',
                ).count()

                if enrolled > 0 and absent / enrolled > 0.60:
                    anomaly, created = AttendanceAnomaly.objects.get_or_create(
                        school=school,
                        anomaly_type=AttendanceAnomaly.AnomalyType.CLASS_BULK,
                        date=yesterday,
                        class_obj=cls,
                        defaults={
                            'severity': AttendanceAnomaly.Severity.HIGH,
                            'description': f'{absent}/{enrolled} students absent in {cls.name} ({absent/enrolled:.0%})',
                            'details': {
                                'class_name': cls.name,
                                'enrolled': enrolled,
                                'absent': absent,
                                'rate': round(absent / enrolled, 2),
                            },
                        },
                    )
                    if created:
                        total_anomalies += 1

            # 2. Student streak: 3+ consecutive days absent
            three_days_ago = yesterday - timedelta(days=2)
            students = Student.objects.filter(school=school, is_active=True)
            for student in students:
                streak = AttendanceRecord.objects.filter(
                    student=student,
                    date__gte=three_days_ago,
                    date__lte=yesterday,
                    status='ABSENT',
                ).count()

                if streak >= 3:
                    anomaly, created = AttendanceAnomaly.objects.get_or_create(
                        school=school,
                        anomaly_type=AttendanceAnomaly.AnomalyType.STUDENT_PATTERN,
                        date=yesterday,
                        student=student,
                        defaults={
                            'severity': AttendanceAnomaly.Severity.MEDIUM,
                            'description': f'{student.name} absent {streak} consecutive days',
                            'details': {
                                'student_name': student.name,
                                'student_roll': student.roll_number,
                                'class_name': student.class_obj.name if student.class_obj else '',
                                'consecutive_days': streak,
                            },
                        },
                    )
                    if created:
                        total_anomalies += 1

            # 3. Unusual school day: school-wide absence >30%
            total_students = Student.objects.filter(
                school=school, is_active=True,
            ).count()
            school_absent = AttendanceRecord.objects.filter(
                school=school, date=yesterday, status='ABSENT',
            ).count()

            if total_students > 10 and school_absent / total_students > 0.30:
                anomaly, created = AttendanceAnomaly.objects.get_or_create(
                    school=school,
                    anomaly_type=AttendanceAnomaly.AnomalyType.UNUSUAL_DAY,
                    date=yesterday,
                    defaults={
                        'severity': AttendanceAnomaly.Severity.HIGH,
                        'description': f'School-wide absence: {school_absent}/{total_students} ({school_absent/total_students:.0%})',
                        'details': {
                            'total_students': total_students,
                            'absent': school_absent,
                            'rate': round(school_absent / total_students, 2),
                        },
                    },
                )
                if created:
                    total_anomalies += 1

            # Alert admins if any anomalies found today
            today_anomalies = AttendanceAnomaly.objects.filter(
                school=school, date=yesterday, is_resolved=False,
            ).count()

            if today_anomalies > 0:
                try:
                    from notifications.triggers import trigger_general
                    trigger_general(
                        school=school,
                        title=f'{today_anomalies} Attendance Anomal{"ies" if today_anomalies > 1 else "y"} Detected',
                        body=f'{today_anomalies} unusual attendance pattern(s) detected on {yesterday}. Review the anomalies page for details.',
                        recipient_type='ADMIN',
                    )
                except Exception as e:
                    logger.warning(f"[Anomaly] Alert failed for school {school.id}: {e}")

        except Exception as e:
            logger.exception(f"[Anomaly] Error for school {school.id}: {e}")

    logger.info(f"[Anomaly] Detection complete: {total_anomalies} new anomalies")
    return {'total_anomalies': total_anomalies}
