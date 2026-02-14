"""
AI Auto-Session Setup Service.

Analyzes the previous academic year and generates a complete setup preview
for a new year, including terms, class-subject mappings, fee structures,
and timetable templates.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Avg, Count

logger = logging.getLogger(__name__)


class SessionSetupService:
    """Generates a new academic year setup based on previous year data."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def generate_setup_preview(self, source_year_id: int, new_year_name: str,
                                new_start_date: date, new_end_date: date,
                                fee_increase_percent: Decimal = Decimal('0')):
        """
        Analyze source year and generate a complete setup preview.

        Returns a dict with all data needed to create the new year,
        without actually creating anything. Admin reviews and confirms.
        """
        from academic_sessions.models import AcademicYear, Term
        from academics.models import ClassSubject, TimetableEntry, TimetableSlot
        from finance.models import FeeStructure
        from students.models import Class

        source_year = AcademicYear.objects.filter(
            id=source_year_id, school_id=self.school_id,
        ).first()

        if not source_year:
            return {'error': 'Source academic year not found.', 'success': False}

        preview = {
            'success': True,
            'source_year': {
                'id': source_year.id,
                'name': source_year.name,
                'start_date': str(source_year.start_date),
                'end_date': str(source_year.end_date),
            },
            'new_year': {
                'name': new_year_name,
                'start_date': str(new_start_date),
                'end_date': str(new_end_date),
            },
            'terms': [],
            'class_subjects': [],
            'fee_structures': [],
            'timetable_summary': {},
            'statistics': {},
            'ai_suggestions': [],
        }

        # 1. Generate terms based on source year patterns
        source_terms = Term.objects.filter(
            academic_year=source_year, school_id=self.school_id, is_active=True,
        ).order_by('order')

        if source_terms.exists():
            year_shift = new_start_date.year - source_year.start_date.year
            for term in source_terms:
                # Shift dates by the year difference
                new_term_start = self._shift_date(term.start_date, year_shift)
                new_term_end = self._shift_date(term.end_date, year_shift)

                # Clamp to new year boundaries
                new_term_start = max(new_term_start, new_start_date)
                new_term_end = min(new_term_end, new_end_date)

                preview['terms'].append({
                    'name': term.name,
                    'term_type': term.term_type,
                    'order': term.order,
                    'start_date': str(new_term_start),
                    'end_date': str(new_term_end),
                    'source_term_id': term.id,
                })
        else:
            # No source terms — suggest default 3-term structure
            preview['terms'] = self._suggest_default_terms(new_start_date, new_end_date)
            preview['ai_suggestions'].append(
                'No terms found in source year. Suggested a default 3-term structure.'
            )

        # 2. Clone class-subject mappings
        source_assignments = ClassSubject.objects.filter(
            school_id=self.school_id, is_active=True,
        ).filter(
            # Get assignments from source year or unlinked ones
            **({'academic_year': source_year} if ClassSubject.objects.filter(
                school_id=self.school_id, academic_year=source_year
            ).exists() else {})
        ).select_related('class_obj', 'subject', 'teacher')

        classes_seen = set()
        for cs in source_assignments:
            classes_seen.add(cs.class_obj_id)
            preview['class_subjects'].append({
                'class_id': cs.class_obj_id,
                'class_name': cs.class_obj.name,
                'subject_id': cs.subject_id,
                'subject_name': cs.subject.name,
                'subject_code': cs.subject.code,
                'teacher_id': cs.teacher_id,
                'teacher_name': cs.teacher.full_name if cs.teacher else 'Unassigned',
                'periods_per_week': cs.periods_per_week,
            })

        # 3. Clone fee structures with optional increase
        source_fees = FeeStructure.objects.filter(
            school_id=self.school_id, is_active=True,
        ).filter(
            **({'academic_year': source_year} if FeeStructure.objects.filter(
                school_id=self.school_id, academic_year=source_year
            ).exists() else {})
        ).select_related('class_obj', 'student')

        multiplier = 1 + (fee_increase_percent / 100)
        for fee in source_fees:
            new_amount = (fee.monthly_amount * multiplier).quantize(Decimal('0.01'))
            preview['fee_structures'].append({
                'class_id': fee.class_obj_id,
                'class_name': fee.class_obj.name if fee.class_obj else None,
                'student_id': fee.student_id,
                'student_name': fee.student.name if fee.student else None,
                'original_amount': str(fee.monthly_amount),
                'new_amount': str(new_amount),
                'increase_percent': str(fee_increase_percent),
            })

        # 4. Timetable summary (we clone the structure, not specific entries)
        timetable_count = TimetableEntry.objects.filter(
            school_id=self.school_id,
        ).filter(
            **({'academic_year': source_year} if TimetableEntry.objects.filter(
                school_id=self.school_id, academic_year=source_year
            ).exists() else {})
        ).count()

        slot_count = TimetableSlot.objects.filter(
            school_id=self.school_id, is_active=True,
        ).count()

        preview['timetable_summary'] = {
            'total_entries': timetable_count,
            'time_slots': slot_count,
            'classes_with_timetable': TimetableEntry.objects.filter(
                school_id=self.school_id,
            ).values('class_obj').distinct().count(),
            'will_clone': timetable_count > 0,
        }

        # 5. Statistics
        from attendance.models import AttendanceRecord
        from examinations.models import StudentMark

        total_classes = Class.objects.filter(
            school_id=self.school_id,
        ).count()

        preview['statistics'] = {
            'total_classes': total_classes,
            'subjects_assigned': len(preview['class_subjects']),
            'fee_structures_count': len(preview['fee_structures']),
            'terms_count': len(preview['terms']),
            'timetable_entries': timetable_count,
        }

        # 6. AI Suggestions based on analysis
        if not source_fees.exists():
            preview['ai_suggestions'].append(
                'No fee structures found to carry forward. You may need to create fee structures manually.'
            )

        if timetable_count == 0:
            preview['ai_suggestions'].append(
                'No timetable found to clone. You can use the AI timetable generator after setup.'
            )

        if fee_increase_percent > 0:
            preview['ai_suggestions'].append(
                f'Fee increase of {fee_increase_percent}% will be applied to all fee structures.'
            )

        return preview

    def apply_setup(self, preview_data: dict, created_by=None):
        """
        Apply the reviewed setup preview — create all entities in bulk.
        Returns summary of what was created.
        """
        from academic_sessions.models import AcademicYear, Term
        from academics.models import ClassSubject, TimetableEntry
        from finance.models import FeeStructure

        result = {
            'success': True,
            'academic_year_id': None,
            'terms_created': 0,
            'class_subjects_created': 0,
            'fee_structures_created': 0,
            'timetable_entries_created': 0,
        }

        try:
            # 1. Create Academic Year
            new_year = AcademicYear.objects.create(
                school_id=self.school_id,
                name=preview_data['new_year']['name'],
                start_date=preview_data['new_year']['start_date'],
                end_date=preview_data['new_year']['end_date'],
                is_current=False,  # Admin explicitly sets current later
            )
            result['academic_year_id'] = new_year.id

            # 2. Create Terms
            for term_data in preview_data.get('terms', []):
                Term.objects.create(
                    school_id=self.school_id,
                    academic_year=new_year,
                    name=term_data['name'],
                    term_type=term_data.get('term_type', 'TERM'),
                    order=term_data['order'],
                    start_date=term_data['start_date'],
                    end_date=term_data['end_date'],
                )
                result['terms_created'] += 1

            # 3. Create Class-Subject Mappings
            for cs_data in preview_data.get('class_subjects', []):
                _, created = ClassSubject.objects.get_or_create(
                    school_id=self.school_id,
                    academic_year=new_year,
                    class_obj_id=cs_data['class_id'],
                    subject_id=cs_data['subject_id'],
                    defaults={
                        'teacher_id': cs_data.get('teacher_id'),
                        'periods_per_week': cs_data.get('periods_per_week', 1),
                    },
                )
                if created:
                    result['class_subjects_created'] += 1

            # 4. Create Fee Structures
            for fee_data in preview_data.get('fee_structures', []):
                FeeStructure.objects.create(
                    school_id=self.school_id,
                    academic_year=new_year,
                    class_obj_id=fee_data.get('class_id'),
                    student_id=fee_data.get('student_id'),
                    monthly_amount=fee_data['new_amount'],
                    effective_from=preview_data['new_year']['start_date'],
                    effective_to=preview_data['new_year']['end_date'],
                )
                result['fee_structures_created'] += 1

            # 5. Clone timetable if source had one
            if preview_data.get('timetable_summary', {}).get('will_clone'):
                source_year_id = preview_data['source_year']['id']
                source_entries = TimetableEntry.objects.filter(
                    school_id=self.school_id,
                ).filter(
                    **({'academic_year_id': source_year_id} if TimetableEntry.objects.filter(
                        school_id=self.school_id, academic_year_id=source_year_id
                    ).exists() else {})
                )

                for entry in source_entries:
                    TimetableEntry.objects.create(
                        school_id=self.school_id,
                        academic_year=new_year,
                        class_obj_id=entry.class_obj_id,
                        day=entry.day,
                        slot_id=entry.slot_id,
                        subject_id=entry.subject_id,
                        teacher_id=entry.teacher_id,
                        room=entry.room,
                    )
                    result['timetable_entries_created'] += 1

        except Exception as e:
            logger.error(f"Session setup failed: {e}")
            result['success'] = False
            result['error'] = str(e)

        return result

    def _shift_date(self, d: date, years: int) -> date:
        """Shift a date by N years, handling leap year edge cases."""
        try:
            return d.replace(year=d.year + years)
        except ValueError:
            # Feb 29 in a non-leap year → Feb 28
            return d.replace(year=d.year + years, day=28)

    def _suggest_default_terms(self, start: date, end: date):
        """Suggest a default 3-term structure for the academic year."""
        total_days = (end - start).days
        term_length = total_days // 3

        terms = []
        for i in range(3):
            t_start = start + timedelta(days=i * term_length)
            if i < 2:
                t_end = start + timedelta(days=(i + 1) * term_length - 1)
            else:
                t_end = end
            terms.append({
                'name': f'Term {i + 1}',
                'term_type': 'TERM',
                'order': i + 1,
                'start_date': str(t_start),
                'end_date': str(t_end),
            })

        return terms
