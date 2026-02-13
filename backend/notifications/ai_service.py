"""
AI Notification Optimizer Service.
Analyzes notification patterns to optimize delivery.
"""

import logging
from django.db.models import Count, Avg, Q
from django.db.models.functions import ExtractHour
from django.utils import timezone

logger = logging.getLogger(__name__)


class NotificationOptimizerService:
    """
    Analyzes notification delivery and engagement patterns.

    Usage:
        service = NotificationOptimizerService(school_id)
        analytics = service.get_delivery_analytics()
        best_time = service.get_optimal_send_time('WHATSAPP', 'PARENT')
    """

    def __init__(self, school_id):
        self.school_id = school_id

    def get_delivery_analytics(self):
        """
        Returns channel effectiveness stats.

        Returns:
            {
                'channels': {
                    'WHATSAPP': {'total': int, 'sent': int, 'failed': int, 'delivery_rate': float},
                    'IN_APP': {'total': int, 'sent': int, 'read': int, 'read_rate': float},
                }
            }
        """
        from .models import NotificationLog

        channels = {}
        for channel in ['WHATSAPP', 'SMS', 'IN_APP', 'EMAIL']:
            qs = NotificationLog.objects.filter(
                school_id=self.school_id,
                channel=channel,
            )
            total = qs.count()
            if total == 0:
                continue

            sent = qs.filter(status__in=['SENT', 'DELIVERED', 'READ']).count()
            failed = qs.filter(status='FAILED').count()
            read = qs.filter(status='READ').count()

            channels[channel] = {
                'total': total,
                'sent': sent,
                'failed': failed,
                'read': read,
                'delivery_rate': round(sent / total * 100, 1) if total > 0 else 0,
                'read_rate': round(read / sent * 100, 1) if sent > 0 else 0,
            }

        return {'channels': channels}

    def get_optimal_send_time(self, channel='WHATSAPP', recipient_type='PARENT'):
        """
        Analyze read timestamps to find the best hour to send notifications.

        Returns:
            {
                'best_hour': int (0-23),
                'best_window': str (e.g., '9:00 AM - 10:00 AM'),
                'hourly_read_rates': dict
            }
        """
        from .models import NotificationLog

        read_logs = NotificationLog.objects.filter(
            school_id=self.school_id,
            channel=channel,
            recipient_type=recipient_type,
            read_at__isnull=False,
        ).annotate(
            read_hour=ExtractHour('read_at')
        ).values('read_hour').annotate(
            count=Count('id')
        ).order_by('read_hour')

        hourly = {r['read_hour']: r['count'] for r in read_logs}

        if not hourly:
            # Default recommendation
            return {
                'best_hour': 9,
                'best_window': '9:00 AM - 10:00 AM',
                'hourly_read_rates': {},
                'note': 'Insufficient data - using default recommendation',
            }

        best_hour = max(hourly, key=hourly.get)
        total_reads = sum(hourly.values())

        # Format window
        am_pm = 'AM' if best_hour < 12 else 'PM'
        display_hour = best_hour if best_hour <= 12 else best_hour - 12
        if display_hour == 0:
            display_hour = 12
        next_hour = display_hour + 1
        next_am_pm = am_pm

        return {
            'best_hour': best_hour,
            'best_window': f'{display_hour}:00 {am_pm} - {next_hour}:00 {next_am_pm}',
            'hourly_read_rates': {
                str(h): round(c / total_reads * 100, 1) for h, c in hourly.items()
            },
        }

    def personalize_message(self, template_body, student, context):
        """
        Use LLM to personalize a template message for a specific student.
        Falls back to simple placeholder replacement.
        """
        try:
            from django.conf import settings
            if not settings.GROQ_API_KEY:
                raise Exception("No API key")

            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            prompt = f"""Personalize this school notification message for a parent. Keep it brief and professional.

Template: {template_body}
Student Name: {student.name}
Class: {student.class_obj.name}
Context: {context}

Return ONLY the personalized message text, nothing else."""

            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=300,
            )
            return response.choices[0].message.content.strip()

        except Exception:
            # Fallback: simple replacement
            result = template_body
            result = result.replace('{{student_name}}', student.name)
            result = result.replace('{{class_name}}', student.class_obj.name)
            for key, value in context.items():
                result = result.replace('{{' + key + '}}', str(value))
            return result
