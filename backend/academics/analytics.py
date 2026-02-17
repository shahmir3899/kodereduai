"""
Academics Predictive Analytics.

Aggregation queries for subject attendance patterns, teacher effectiveness,
optimal slot recommendations, and attendance trends.
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

from django.db.models import Count, Q, Avg

logger = logging.getLogger(__name__)


class AcademicsAnalytics:
    """Aggregation-based analytics for academic scheduling."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def subject_attendance_by_slot(self, date_from=None, date_to=None) -> dict:
        """Compute attendance rates per subject grouped by morning/afternoon."""
        from attendance.models import AttendanceRecord
        from .models import TimetableEntry, TimetableSlot

        slots = list(
            TimetableSlot.objects.filter(
                school_id=self.school_id, slot_type='PERIOD', is_active=True
            ).order_by('order')
        )
        if not slots:
            return {'subjects': [], 'message': 'No time slots defined.'}

        mid = len(slots) // 2
        morning_slot_ids = {s.id for i, s in enumerate(slots) if i < mid}
        afternoon_slot_ids = {s.id for i, s in enumerate(slots) if i >= mid}

        entries = TimetableEntry.objects.filter(
            school_id=self.school_id, subject__isnull=False
        ).select_related('subject', 'class_obj', 'slot')

        # Build class-day-subject mapping from timetable
        class_day_subject = defaultdict(set)
        subject_slots = defaultdict(lambda: {'morning': 0, 'afternoon': 0, 'total': 0})

        for entry in entries:
            class_day_subject[(entry.class_obj_id, entry.day)].add(entry.subject_id)
            key = entry.subject.name
            if entry.slot_id in morning_slot_ids:
                subject_slots[key]['morning'] += 1
            else:
                subject_slots[key]['afternoon'] += 1
            subject_slots[key]['total'] += 1

        # Get attendance records
        att_qs = AttendanceRecord.objects.filter(school_id=self.school_id)
        if date_from:
            att_qs = att_qs.filter(date__gte=date_from)
        if date_to:
            att_qs = att_qs.filter(date__lte=date_to)

        # Aggregate attendance by class and date
        # AttendanceRecord -> Student -> class_obj (FK path)
        class_date_attendance = att_qs.values(
            'student__class_obj_id', 'date'
        ).annotate(
            total=Count('id'),
            present=Count('id', filter=Q(status='PRESENT')),
        )

        # Map day-of-week to our DAY codes
        day_map = {0: 'MON', 1: 'TUE', 2: 'WED', 3: 'THU', 4: 'FRI', 5: 'SAT'}

        # Compute per-subject attendance rates
        subject_rates = defaultdict(lambda: {'morning_total': 0, 'morning_present': 0,
                                              'afternoon_total': 0, 'afternoon_present': 0})

        for record in class_date_attendance:
            record_date = record['date']
            day_code = day_map.get(record_date.weekday())
            if not day_code:
                continue

            class_id = record['student__class_obj_id']
            subjects_for_day = class_day_subject.get((class_id, day_code), set())

            from .models import TimetableEntry as TE
            day_entries = TE.objects.filter(
                school_id=self.school_id,
                class_obj_id=class_id,
                day=day_code,
                subject__isnull=False,
            ).select_related('subject', 'slot')

            for entry in day_entries:
                subj_name = entry.subject.name
                if entry.slot_id in morning_slot_ids:
                    subject_rates[subj_name]['morning_total'] += record['total']
                    subject_rates[subj_name]['morning_present'] += record['present']
                else:
                    subject_rates[subj_name]['afternoon_total'] += record['total']
                    subject_rates[subj_name]['afternoon_present'] += record['present']

        results = []
        for name, data in subject_slots.items():
            rates = subject_rates.get(name, {})
            morning_rate = (
                round(rates.get('morning_present', 0) / rates['morning_total'] * 100, 1)
                if rates.get('morning_total', 0) > 0 else None
            )
            afternoon_rate = (
                round(rates.get('afternoon_present', 0) / rates['afternoon_total'] * 100, 1)
                if rates.get('afternoon_total', 0) > 0 else None
            )
            total_present = rates.get('morning_present', 0) + rates.get('afternoon_present', 0)
            total_all = rates.get('morning_total', 0) + rates.get('afternoon_total', 0)
            overall_rate = round(total_present / total_all * 100, 1) if total_all > 0 else None

            results.append({
                'subject_name': name,
                'morning_periods': data['morning'],
                'afternoon_periods': data['afternoon'],
                'morning_rate': morning_rate,
                'afternoon_rate': afternoon_rate,
                'overall_rate': overall_rate,
            })

        results.sort(key=lambda x: x.get('overall_rate') or 0, reverse=True)
        return {'subjects': results}

    def teacher_effectiveness(self, date_from=None, date_to=None) -> dict:
        """Per-teacher average class attendance rate + appraisal rating."""
        from hr.models import PerformanceAppraisal, StaffMember
        from attendance.models import AttendanceRecord
        from .models import TimetableEntry

        # Get teachers with timetable entries
        teacher_entries = TimetableEntry.objects.filter(
            school_id=self.school_id, teacher__isnull=False
        ).values('teacher_id', 'teacher__first_name', 'teacher__last_name').annotate(
            classes_count=Count('class_obj_id', distinct=True),
            total_periods=Count('id'),
        )

        att_qs = AttendanceRecord.objects.filter(school_id=self.school_id)
        if date_from:
            att_qs = att_qs.filter(date__gte=date_from)
        if date_to:
            att_qs = att_qs.filter(date__lte=date_to)

        # Get class attendance rates (AttendanceRecord -> Student -> class_obj)
        class_attendance = att_qs.values('student__class_obj_id').annotate(
            total=Count('id'),
            present=Count('id', filter=Q(status='PRESENT')),
        )
        class_rate_map = {}
        for ca in class_attendance:
            if ca['total'] > 0:
                class_rate_map[ca['student__class_obj_id']] = round(ca['present'] / ca['total'] * 100, 1)

        # Get teacher-class mapping
        teacher_classes = TimetableEntry.objects.filter(
            school_id=self.school_id, teacher__isnull=False
        ).values('teacher_id').annotate(
            class_ids=Count('class_obj_id', distinct=True)
        )

        teacher_class_map = defaultdict(set)
        for entry in TimetableEntry.objects.filter(
            school_id=self.school_id, teacher__isnull=False
        ).values_list('teacher_id', 'class_obj_id').distinct():
            teacher_class_map[entry[0]].add(entry[1])

        # Get appraisal ratings
        ratings = PerformanceAppraisal.objects.filter(
            school_id=self.school_id
        ).values('staff_member_id').annotate(avg_rating=Avg('rating'))
        rating_map = {r['staff_member_id']: round(r['avg_rating'], 1) for r in ratings}

        results = []
        for te in teacher_entries:
            tid = te['teacher_id']
            teacher_name = f"{te['teacher__first_name']} {te['teacher__last_name']}"

            # Compute avg attendance across classes this teacher teaches
            class_ids = teacher_class_map.get(tid, set())
            class_rates = [class_rate_map[cid] for cid in class_ids if cid in class_rate_map]
            avg_attendance = round(sum(class_rates) / len(class_rates), 1) if class_rates else None

            avg_rating = rating_map.get(tid)
            # Scale rating (1-5) to percentage (0-100) for chart display
            avg_rating_scaled = round(avg_rating * 20, 1) if avg_rating is not None else None

            results.append({
                'teacher_id': tid,
                'teacher_name': teacher_name,
                'avg_class_attendance_rate': avg_attendance,
                'avg_rating': avg_rating,
                'avg_rating_scaled': avg_rating_scaled,
                'classes_count': te['classes_count'],
                'total_periods': te['total_periods'],
            })

        results.sort(key=lambda x: x.get('avg_class_attendance_rate') or 0, reverse=True)
        return {'teachers': results}

    def optimal_slot_recommendations(self) -> dict:
        """Recommend optimal time slots for subjects based on attendance patterns."""
        data = self.subject_attendance_by_slot()
        recommendations = []

        for subj in data.get('subjects', []):
            morning = subj.get('morning_rate')
            afternoon = subj.get('afternoon_rate')

            if morning is not None and afternoon is not None:
                diff = morning - afternoon
                if abs(diff) >= 3:
                    if diff > 0:
                        recommendations.append({
                            'subject_name': subj['subject_name'],
                            'recommended_time': 'morning',
                            'evidence': f'{diff:.1f}% higher attendance in morning slots',
                            'morning_rate': morning,
                            'afternoon_rate': afternoon,
                        })
                    else:
                        recommendations.append({
                            'subject_name': subj['subject_name'],
                            'recommended_time': 'afternoon',
                            'evidence': f'{abs(diff):.1f}% higher attendance in afternoon slots',
                            'morning_rate': morning,
                            'afternoon_rate': afternoon,
                        })

        recommendations.sort(key=lambda x: abs(
            (x.get('morning_rate') or 0) - (x.get('afternoon_rate') or 0)
        ), reverse=True)

        return {'recommendations': recommendations}

    def attendance_trends(self, months: int = 6) -> dict:
        """Monthly attendance rates per class over last N months."""
        from attendance.models import AttendanceRecord

        end_date = date.today()
        start_date = date(end_date.year, end_date.month, 1) - timedelta(days=30 * (months - 1))

        records = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            date__gte=start_date,
            date__lte=end_date,
        ).values(
            'student__class_obj_id', 'student__class_obj__name', 'date__year', 'date__month'
        ).annotate(
            total=Count('id'),
            present=Count('id', filter=Q(status='PRESENT')),
        ).order_by('date__year', 'date__month')

        month_data = defaultdict(lambda: defaultdict(dict))
        for r in records:
            month_key = f"{r['date__year']}-{r['date__month']:02d}"
            class_name = r['student__class_obj__name']
            rate = round(r['present'] / r['total'] * 100, 1) if r['total'] > 0 else 0
            month_data[month_key][class_name] = rate

        months_list = []
        for month_key in sorted(month_data.keys()):
            classes = [
                {'class_name': cn, 'rate': rate}
                for cn, rate in sorted(month_data[month_key].items())
            ]
            months_list.append({
                'month': month_key,
                'classes': classes,
            })

        return {'months': months_list}
