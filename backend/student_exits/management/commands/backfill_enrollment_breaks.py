"""One-time backfill of away periods for students re-activated before breaks existed.

Before EnrollmentBreak, setting a departed student back to Active erased their
leaving date, so nothing remembers the months they were away. If you know of such
a student, list them in a CSV and run this. It is a DRY RUN unless --apply is given.

    python manage.py backfill_enrollment_breaks --csv away.csv            # check only
    python manage.py backfill_enrollment_breaks --csv away.csv --apply    # write

CSV (header required; dates YYYY-MM-DD; end_date is the first day back):

    student_id,start_date,end_date,reason
    141,2026-03-02,2026-04-20,Family abroad

Every row is checked first. Without --skip-invalid, one bad row stops the whole
run and nothing is written; with it, the good rows are applied and the bad ones
are reported.
"""
import csv
from datetime import date, datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from core.audit import log_admin_action
from student_exits.models import EnrollmentBreak
from students.models import Student

REQUIRED_COLUMNS = {'student_id', 'start_date', 'end_date'}
EARLIEST = date(2000, 1, 1)


def _parse_date(text, column):
    try:
        return datetime.strptime((text or '').strip(), '%Y-%m-%d').date()
    except ValueError:
        raise ValueError(f'{column} must be YYYY-MM-DD, got {text!r}')


def read_rows(path):
    try:
        handle = open(path, newline='', encoding='utf-8-sig')
    except OSError as exc:
        raise CommandError(f'Cannot read {path}: {exc}')
    with handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise CommandError(f'CSV is missing columns: {", ".join(sorted(missing))}')
        return [(index, row) for index, row in enumerate(reader, start=2)]  # line 1 is the header


def check_row(row, *, school_id=None, today=None, planned=None):
    """Return (problem, parsed). problem is None when the row can be applied.
    `planned` holds (student_id, start, end) rows already accepted in this run, so
    two rows of one file cannot overlap each other either."""
    today = today or date.today()
    planned = planned if planned is not None else []
    raw_id = (row.get('student_id') or '').strip()
    if not raw_id.isdigit():
        return f'student_id must be a whole number, got {raw_id!r}', None
    try:
        student_id = int(raw_id)
        start = _parse_date(row.get('start_date'), 'start_date')
        end = _parse_date(row.get('end_date'), 'end_date')
    except ValueError as exc:
        return str(exc), None

    parsed = {'student_id': student_id, 'start': start, 'end': end, 'reason': (row.get('reason') or '').strip()}
    student = Student.objects.filter(pk=student_id).first()
    if student is None:
        return f'student {student_id} not found', parsed
    parsed['student'] = student
    if school_id and student.school_id != school_id:
        return f'student {student_id} belongs to school {student.school_id}, not {school_id}', parsed
    if start < EARLIEST:
        return f'start_date {start} is implausibly early', parsed
    if end <= start:
        return 'end_date must be after start_date (end_date is the first day back)', parsed
    if end > today:
        return 'end_date is in the future: a backfill records past absences only (use Re-admit for a future return)', parsed

    clash = EnrollmentBreak.objects.filter(student=student, start_date__lt=end).filter(
        Q(end_date__isnull=True) | Q(end_date__gt=start),
    ).first()
    if clash:
        return (f'overlaps a recorded break ({clash.start_date} to {clash.end_date or "still away"})'), parsed
    if any(sid == student_id and start < p_end and p_start < end for sid, p_start, p_end in planned):
        return 'overlaps another row in this file', parsed
    planned.append((student_id, start, end))
    return None, parsed


class Command(BaseCommand):
    help = 'Record past away periods for students re-activated before breaks existed (dry run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument('--csv', required=True, help='CSV with student_id,start_date,end_date[,reason]')
        parser.add_argument('--apply', action='store_true', help='Write the breaks (default is a dry run).')
        parser.add_argument('--skip-invalid', action='store_true',
                            help='Apply the valid rows and report the invalid ones instead of stopping.')
        parser.add_argument('--school-id', type=int, default=None,
                            help='Refuse rows for students of any other school.')

    def handle(self, *args, **options):
        rows = read_rows(options['csv'])
        if not rows:
            raise CommandError('The CSV has no rows.')

        planned, good, bad = [], [], []
        for line, row in rows:
            problem, parsed = check_row(row, school_id=options['school_id'], planned=planned)
            (bad if problem else good).append((line, parsed, problem))

        mode = 'APPLY' if options['apply'] else 'DRY RUN'
        self.stdout.write(f'{mode}: {len(rows)} row(s) read from {options["csv"]}')
        for line, parsed, _ in good:
            name = parsed['student'].name
            self.stdout.write(self.style.SUCCESS(
                f'  line {line}: OK    student {parsed["student_id"]} ({name}) away {parsed["start"]} to {parsed["end"]}'
            ))
        for line, parsed, problem in bad:
            who = f'student {parsed["student_id"]}' if parsed and 'student_id' in parsed else 'row'
            self.stdout.write(self.style.ERROR(f'  line {line}: SKIP  {who}: {problem}'))
        self.stdout.write(f'{len(good)} valid, {len(bad)} invalid.')

        if bad and not options['skip_invalid']:
            raise CommandError('Some rows are invalid, so nothing was written. Fix them, or use --skip-invalid.')
        if not options['apply']:
            self.stdout.write('Dry run: nothing was written. Add --apply to record the valid rows.')
            return

        with transaction.atomic():
            for _, parsed, _ in good:
                student = parsed['student']
                EnrollmentBreak.objects.create(
                    school_id=student.school_id, student=student,
                    start_date=parsed['start'], end_date=parsed['end'], reason=parsed['reason'],
                )
                log_admin_action(None, 'enrollment_break_backfilled', student, metadata={
                    'start_date': parsed['start'].isoformat(), 'end_date': parsed['end'].isoformat(),
                    'reason': parsed['reason'],
                })
        self.stdout.write(self.style.SUCCESS(f'Recorded {len(good)} break(s).'))
