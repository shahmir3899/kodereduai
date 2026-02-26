"""
AI Auto-Session Setup Service.

Analyzes the previous academic year and generates a complete setup preview
for a new year, including terms, class-subject mappings, and timetable
templates. Supports both create and sync (update) modes — auto-detected
based on whether the target year name already exists.
"""

import logging
from datetime import date, timedelta

from django.db import transaction

logger = logging.getLogger(__name__)


class SessionSetupService:
    """Generates a new academic year setup based on previous year data."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def generate_setup_preview(self, source_year_id: int, new_year_name: str,
                                new_start_date: date, new_end_date: date):
        """
        Analyze source year and generate a complete setup preview.

        Returns a dict with all data needed to create/sync the new year,
        without actually creating anything. Admin reviews and confirms.

        Auto-detects sync mode when target year name already exists.
        """
        from academic_sessions.models import AcademicYear, Term
        from academics.models import ClassSubject, TimetableEntry, TimetableSlot

        source_year = AcademicYear.objects.filter(
            id=source_year_id, school_id=self.school_id,
        ).first()

        if not source_year:
            return {'error': 'Source academic year not found.', 'success': False}

        # Detect sync mode: does the target year already exist?
        existing_year = AcademicYear.objects.filter(
            school_id=self.school_id, name=new_year_name, is_active=True,
        ).first()
        sync_mode = existing_year is not None

        preview = {
            'success': True,
            'sync_mode': sync_mode,
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
            'timetable_summary': {},
            'statistics': {},
            'sync_statistics': None,
            'ai_suggestions': [],
        }

        if existing_year:
            preview['existing_year_id'] = existing_year.id

        # 1. Generate terms based on source year patterns
        source_terms = Term.objects.filter(
            academic_year=source_year, school_id=self.school_id, is_active=True,
        ).order_by('order')

        if source_terms.exists():
            year_shift = new_start_date.year - source_year.start_date.year
            for term in source_terms:
                new_term_start = self._shift_date(term.start_date, year_shift)
                new_term_end = self._shift_date(term.end_date, year_shift)

                # Clamp to new year boundaries
                new_term_start = max(new_term_start, new_start_date)
                new_term_end = min(new_term_end, new_end_date)

                term_dict = {
                    'name': term.name,
                    'term_type': term.term_type,
                    'order': term.order,
                    'start_date': str(new_term_start),
                    'end_date': str(new_term_end),
                    'source_term_id': term.id,
                }

                # Sync annotation
                if sync_mode:
                    existing_term = Term.objects.filter(
                        school_id=self.school_id,
                        academic_year=existing_year,
                        name=term.name,
                    ).first()
                    if existing_term:
                        changes = {}
                        if str(existing_term.start_date) != str(new_term_start):
                            changes['start_date'] = {'old': str(existing_term.start_date), 'new': str(new_term_start)}
                        if str(existing_term.end_date) != str(new_term_end):
                            changes['end_date'] = {'old': str(existing_term.end_date), 'new': str(new_term_end)}
                        term_dict['action'] = 'update' if changes else 'skip'
                        term_dict['changes'] = changes
                    else:
                        term_dict['action'] = 'create'
                else:
                    term_dict['action'] = 'create'

                preview['terms'].append(term_dict)
        else:
            preview['terms'] = self._suggest_default_terms(new_start_date, new_end_date)
            for t in preview['terms']:
                t['action'] = 'create'
            preview['ai_suggestions'].append(
                'Source year has no terms to clone. A default 3-term structure has been created below — you can adjust dates after setup.'
            )

        # 2. Clone class-subject mappings
        source_assignments = ClassSubject.objects.filter(
            school_id=self.school_id, is_active=True,
        ).filter(
            **({'academic_year': source_year} if ClassSubject.objects.filter(
                school_id=self.school_id, academic_year=source_year
            ).exists() else {})
        ).select_related('class_obj', 'subject', 'teacher')

        for cs in source_assignments:
            cs_dict = {
                'class_id': cs.class_obj_id,
                'class_name': cs.class_obj.name,
                'subject_id': cs.subject_id,
                'subject_name': cs.subject.name,
                'subject_code': cs.subject.code,
                'teacher_id': cs.teacher_id,
                'teacher_name': cs.teacher.full_name if cs.teacher else 'Unassigned',
                'periods_per_week': cs.periods_per_week,
            }

            # Sync annotation — unique key is (school, class_obj, subject)
            if sync_mode:
                existing_cs = ClassSubject.objects.filter(
                    school_id=self.school_id,
                    class_obj_id=cs.class_obj_id,
                    subject_id=cs.subject_id,
                ).select_related('teacher').first()
                if existing_cs:
                    changes = {}
                    if existing_cs.teacher_id != cs.teacher_id:
                        changes['teacher'] = {
                            'old': existing_cs.teacher.full_name if existing_cs.teacher else 'Unassigned',
                            'new': cs.teacher.full_name if cs.teacher else 'Unassigned',
                        }
                    if existing_cs.periods_per_week != cs.periods_per_week:
                        changes['periods_per_week'] = {
                            'old': existing_cs.periods_per_week,
                            'new': cs.periods_per_week,
                        }
                    cs_dict['action'] = 'update' if changes else 'skip'
                    cs_dict['changes'] = changes
                else:
                    cs_dict['action'] = 'create'
            else:
                cs_dict['action'] = 'create'

            preview['class_subjects'].append(cs_dict)

        # 3. Timetable summary
        source_entries = TimetableEntry.objects.filter(
            school_id=self.school_id,
        ).filter(
            **({'academic_year': source_year} if TimetableEntry.objects.filter(
                school_id=self.school_id, academic_year=source_year
            ).exists() else {})
        )
        timetable_count = source_entries.count()

        slot_count = TimetableSlot.objects.filter(
            school_id=self.school_id, is_active=True,
        ).count()

        preview['timetable_summary'] = {
            'total_entries': timetable_count,
            'time_slots': slot_count,
            'classes_with_timetable': source_entries.values('class_obj').distinct().count(),
            'will_clone': timetable_count > 0,
        }

        # Timetable sync annotation
        if sync_mode and timetable_count > 0:
            overlap = 0
            new_count = 0
            for entry in source_entries.only('class_obj_id', 'day', 'slot_id'):
                exists = TimetableEntry.objects.filter(
                    school_id=self.school_id,
                    class_obj_id=entry.class_obj_id,
                    day=entry.day,
                    slot_id=entry.slot_id,
                ).exists()
                if exists:
                    overlap += 1
                else:
                    new_count += 1
            preview['timetable_summary']['updates'] = overlap
            preview['timetable_summary']['new'] = new_count

        # 4. Statistics
        preview['statistics'] = {
            'subjects_assigned': len(preview['class_subjects']),
            'terms_count': len(preview['terms']),
            'timetable_entries': timetable_count,
        }

        # 5. Sync statistics
        if sync_mode:
            sync_stats = {
                'terms': {'create': 0, 'update': 0, 'skip': 0},
                'class_subjects': {'create': 0, 'update': 0, 'skip': 0},
                'timetable': {
                    'create': preview['timetable_summary'].get('new', 0),
                    'update': preview['timetable_summary'].get('updates', 0),
                    'skip': 0,
                },
            }
            for t in preview['terms']:
                sync_stats['terms'][t.get('action', 'create')] += 1
            for cs in preview['class_subjects']:
                sync_stats['class_subjects'][cs.get('action', 'create')] += 1
            preview['sync_statistics'] = sync_stats

        # 6. AI Suggestions
        if timetable_count == 0:
            preview['ai_suggestions'].append(
                'Timetable will not be cloned (none found in source year). You can generate one using AI after setup.'
            )

        if sync_mode:
            preview['ai_suggestions'].append(
                f'Year "{new_year_name}" already exists. Running in sync mode — existing data will be updated, missing data will be created.'
            )

        return preview

    def apply_setup(self, preview_data: dict, created_by=None):
        """
        Apply the reviewed setup preview — create or sync all entities.

        Uses update_or_create patterns for idempotent sync support.
        Safe to re-run without creating duplicates.
        """
        from academic_sessions.models import AcademicYear, Term
        from academics.models import ClassSubject, TimetableEntry

        result = {
            'success': True,
            'sync_mode': False,
            'academic_year_id': None,
            'terms_created': 0,
            'terms_updated': 0,
            'terms_skipped': 0,
            'class_subjects_created': 0,
            'class_subjects_updated': 0,
            'timetable_entries_created': 0,
            'timetable_entries_updated': 0,
        }

        try:
            with transaction.atomic():
                # 1. Get or Create Academic Year
                new_year, year_created = AcademicYear.objects.get_or_create(
                    school_id=self.school_id,
                    name=preview_data['new_year']['name'],
                    defaults={
                        'start_date': preview_data['new_year']['start_date'],
                        'end_date': preview_data['new_year']['end_date'],
                        'is_current': False,
                    },
                )
                if not year_created:
                    new_year.start_date = preview_data['new_year']['start_date']
                    new_year.end_date = preview_data['new_year']['end_date']
                    new_year.save(update_fields=['start_date', 'end_date', 'updated_at'])
                    result['sync_mode'] = True

                result['academic_year_id'] = new_year.id

                # 2. Create or Update Terms
                for term_data in preview_data.get('terms', []):
                    term, created = Term.objects.update_or_create(
                        school_id=self.school_id,
                        academic_year=new_year,
                        name=term_data['name'],
                        defaults={
                            'term_type': term_data.get('term_type', 'TERM'),
                            'order': term_data['order'],
                            'start_date': term_data['start_date'],
                            'end_date': term_data['end_date'],
                            'is_active': True,
                        },
                    )
                    if created:
                        result['terms_created'] += 1
                    else:
                        result['terms_updated'] += 1

                # 3. Create or Update Class-Subject Mappings
                # Unique constraint: (school, class_obj, subject) — academic_year in defaults
                for cs_data in preview_data.get('class_subjects', []):
                    cs, created = ClassSubject.objects.update_or_create(
                        school_id=self.school_id,
                        class_obj_id=cs_data['class_id'],
                        subject_id=cs_data['subject_id'],
                        defaults={
                            'academic_year': new_year,
                            'teacher_id': cs_data.get('teacher_id'),
                            'periods_per_week': cs_data.get('periods_per_week', 1),
                            'is_active': True,
                        },
                    )
                    if created:
                        result['class_subjects_created'] += 1
                    else:
                        result['class_subjects_updated'] += 1

                # 4. Clone/Update Timetable
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
                        tt, created = TimetableEntry.objects.update_or_create(
                            school_id=self.school_id,
                            class_obj_id=entry.class_obj_id,
                            day=entry.day,
                            slot_id=entry.slot_id,
                            defaults={
                                'academic_year': new_year,
                                'subject_id': entry.subject_id,
                                'teacher_id': entry.teacher_id,
                                'room': entry.room,
                            },
                        )
                        if created:
                            result['timetable_entries_created'] += 1
                        else:
                            result['timetable_entries_updated'] += 1

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
