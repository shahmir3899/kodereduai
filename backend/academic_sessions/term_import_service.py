from datetime import date

from django.db import transaction

from .models import Term


class TermImportService:
    def __init__(self, school_id):
        self.school_id = school_id

    @staticmethod
    def _shift_date(value, year_delta):
        try:
            return value.replace(year=value.year + year_delta)
        except ValueError:
            # Handle Feb 29 in non-leap years.
            return value.replace(month=2, day=28, year=value.year + year_delta)

    @staticmethod
    def _normalize_name(value):
        return (value or '').strip().lower()

    def build_preview(self, source_academic_year, target_academic_year, conflict_mode='skip', include_inactive=False):
        source_terms = Term.objects.filter(
            school_id=self.school_id,
            academic_year=source_academic_year,
        ).order_by('order', 'id')

        if not include_inactive:
            source_terms = source_terms.filter(is_active=True)

        year_shift = target_academic_year.start_date.year - source_academic_year.start_date.year

        target_terms = list(
            Term.objects.filter(
                school_id=self.school_id,
                academic_year=target_academic_year,
            )
        )

        existing_by_name = {}
        existing_by_order = {}
        for term in target_terms:
            existing_by_name.setdefault(self._normalize_name(term.name), term)
            existing_by_order.setdefault(term.order, term)

        term_rows = []
        counts = {'create': 0, 'update': 0, 'skip': 0, 'conflict': 0}

        scheduled = [
            {
                'id': term.id,
                'name': term.name,
                'order': term.order,
                'start_date': term.start_date,
                'end_date': term.end_date,
            }
            for term in target_terms
        ]

        def _find_schedule_conflict(start_date, end_date, order, exclude_id=None):
            for item in scheduled:
                if exclude_id and item['id'] == exclude_id:
                    continue
                if item['order'] == order:
                    return f"Order {order} already exists in target academic year."
                if start_date < item['end_date'] and end_date > item['start_date']:
                    return f"Date range overlaps with existing term '{item['name']}'."
            return None

        for source_term in source_terms:
            shifted_start = self._shift_date(source_term.start_date, year_shift)
            shifted_end = self._shift_date(source_term.end_date, year_shift)

            adjusted_start = max(shifted_start, target_academic_year.start_date)
            adjusted_end = min(shifted_end, target_academic_year.end_date)

            row = {
                'source_term_id': source_term.id,
                'name': source_term.name,
                'term_type': source_term.term_type,
                'order': source_term.order,
                'source_start_date': str(source_term.start_date),
                'source_end_date': str(source_term.end_date),
                'start_date': str(adjusted_start),
                'end_date': str(adjusted_end),
                'is_active': bool(source_term.is_active),
                'action': 'create',
                'reason': '',
            }

            if adjusted_start >= adjusted_end:
                row['action'] = 'conflict'
                row['reason'] = 'Adjusted dates are invalid after clamping to target academic year.'
                counts['conflict'] += 1
                term_rows.append(row)
                continue

            normalized_name = self._normalize_name(source_term.name)
            existing_name_term = existing_by_name.get(normalized_name)
            existing_order_term = existing_by_order.get(source_term.order)
            target_term = None

            if existing_name_term and existing_order_term and existing_name_term.id != existing_order_term.id:
                row['action'] = 'conflict'
                row['reason'] = (
                    'Conflicting matches in target year: term name matches one row and order matches another row.'
                )
                counts['conflict'] += 1
                term_rows.append(row)
                continue

            if existing_name_term:
                target_term = existing_name_term
            elif existing_order_term and conflict_mode == 'update':
                target_term = existing_order_term
                row['reason'] = 'Matched existing term by order for update.'

            if target_term:
                if conflict_mode == 'update':
                    row['action'] = 'update'
                    row['existing_term_id'] = target_term.id
                    conflict_reason = _find_schedule_conflict(
                        adjusted_start,
                        adjusted_end,
                        source_term.order,
                        exclude_id=target_term.id,
                    )
                    if conflict_reason:
                        row['action'] = 'conflict'
                        row['reason'] = conflict_reason
                        counts['conflict'] += 1
                    else:
                        counts['update'] += 1
                        for item in scheduled:
                            if item['id'] == target_term.id:
                                item['name'] = source_term.name
                                item['order'] = source_term.order
                                item['start_date'] = adjusted_start
                                item['end_date'] = adjusted_end
                                break
                else:
                    row['action'] = 'skip'
                    row['existing_term_id'] = target_term.id
                    row['reason'] = 'Matching term already exists in target year.'
                    counts['skip'] += 1
            else:
                conflict_reason = _find_schedule_conflict(
                    adjusted_start,
                    adjusted_end,
                    source_term.order,
                    exclude_id=None,
                )
                if conflict_reason:
                    row['action'] = 'conflict'
                    row['reason'] = conflict_reason
                    counts['conflict'] += 1
                else:
                    counts['create'] += 1
                    scheduled.append({
                        'id': -(len(scheduled) + 1),
                        'name': source_term.name,
                        'order': source_term.order,
                        'start_date': adjusted_start,
                        'end_date': adjusted_end,
                    })

            term_rows.append(row)

        return {
            'source_year': {
                'id': source_academic_year.id,
                'name': source_academic_year.name,
                'start_date': str(source_academic_year.start_date),
                'end_date': str(source_academic_year.end_date),
            },
            'target_year': {
                'id': target_academic_year.id,
                'name': target_academic_year.name,
                'start_date': str(target_academic_year.start_date),
                'end_date': str(target_academic_year.end_date),
            },
            'conflict_mode': conflict_mode,
            'include_inactive': bool(include_inactive),
            'counts': counts,
            'terms': term_rows,
            'total_source_terms': source_terms.count(),
        }

    def apply_from_preview(self, preview):
        created = 0
        updated = 0
        skipped = 0
        conflicts = 0

        target_year_id = preview['target_year']['id']

        with transaction.atomic():
            for row in preview.get('terms', []):
                action = row.get('action')
                if action == 'conflict':
                    conflicts += 1
                    continue
                if action == 'skip':
                    skipped += 1
                    continue

                payload = {
                    'school_id': self.school_id,
                    'academic_year_id': target_year_id,
                    'name': row['name'],
                    'term_type': row['term_type'],
                    'order': row['order'],
                    'start_date': date.fromisoformat(row['start_date']),
                    'end_date': date.fromisoformat(row['end_date']),
                    'is_active': True,
                }

                if action == 'update':
                    term_id = row.get('existing_term_id')
                    if not term_id:
                        skipped += 1
                        continue
                    updated_count = Term.objects.filter(
                        id=term_id,
                        school_id=self.school_id,
                        academic_year_id=target_year_id,
                    ).update(**{k: v for k, v in payload.items() if k not in {'school_id', 'academic_year_id', 'name'}})
                    if updated_count:
                        updated += 1
                    else:
                        skipped += 1
                    continue

                _, was_created = Term.objects.get_or_create(
                    school_id=self.school_id,
                    academic_year_id=target_year_id,
                    name=row['name'],
                    defaults={
                        'term_type': payload['term_type'],
                        'order': payload['order'],
                        'start_date': payload['start_date'],
                        'end_date': payload['end_date'],
                        'is_active': payload['is_active'],
                    },
                )
                if was_created:
                    created += 1
                else:
                    skipped += 1

        return {
            'created': created,
            'updated': updated,
            'skipped': skipped,
            'conflicts': conflicts,
        }
