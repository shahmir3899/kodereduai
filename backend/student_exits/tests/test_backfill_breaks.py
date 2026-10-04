"""backfill_enrollment_breaks: dry run by default, all-or-nothing, never overlaps."""
from datetime import date, timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from academic_sessions.leaving import left_by
from core.models import AdminActionLog
from student_exits.models import EnrollmentBreak


@pytest.fixture
def student(seed_data):
    return seed_data['students'][0]


def run(tmp_path, rows, *args, header='student_id,start_date,end_date,reason'):
    path = tmp_path / 'away.csv'
    path.write_text('\n'.join([header, *rows]) + '\n', encoding='utf-8')
    out = StringIO()
    try:
        call_command('backfill_enrollment_breaks', '--csv', str(path), *args, stdout=out)
    except CommandError as exc:
        return out.getvalue(), exc
    return out.getvalue(), None


class TestDryRun:
    def test_nothing_is_written_without_apply(self, tmp_path, student):
        out, err = run(tmp_path, [f'{student.id},2026-03-02,2026-04-20,Family abroad'])
        assert err is None
        assert 'DRY RUN' in out and '1 valid, 0 invalid' in out
        assert 'Dry run: nothing was written' in out
        assert 'away 2026-03-02 to 2026-04-20' in out
        assert EnrollmentBreak.objects.count() == 0

    def test_apply_writes_the_break_and_an_audit_entry(self, tmp_path, student):
        out, err = run(tmp_path, [f'{student.id},2026-03-02,2026-04-20,Family abroad'], '--apply')
        assert err is None and 'Recorded 1 break(s).' in out
        brk = EnrollmentBreak.objects.get()
        assert (brk.student_id, brk.start_date, brk.end_date, brk.reason) == (
            student.id, date(2026, 3, 2), date(2026, 4, 20), 'Family abroad')
        assert brk.school_id == student.school_id and brk.exit_id is None
        assert AdminActionLog.objects.filter(action='enrollment_break_backfilled').count() == 1

    def test_a_backfilled_break_is_honoured_by_the_guards(self, tmp_path, student):
        run(tmp_path, [f'{student.id},2026-03-02,2026-04-20,'], '--apply')
        assert left_by(student.school_id, [student.id], date(2026, 3, 10)) == {student.id: date(2026, 3, 2)}
        assert left_by(student.school_id, [student.id], date(2026, 4, 20)) == {}

    def test_the_reason_column_is_optional(self, tmp_path, student):
        out, err = run(tmp_path, [f'{student.id},2026-03-02,2026-04-20'], '--apply', header='student_id,start_date,end_date')
        assert err is None
        assert EnrollmentBreak.objects.get().reason == ''


class TestInvalidRows:
    def test_one_bad_row_stops_everything_and_writes_nothing(self, tmp_path, student):
        out, err = run(tmp_path, [
            f'{student.id},2026-03-02,2026-04-20,ok',
            '999999,2026-03-02,2026-04-20,nobody',
        ], '--apply')
        assert err is not None and 'nothing was written' in str(err)
        assert 'student 999999 not found' in out
        assert EnrollmentBreak.objects.count() == 0

    def test_skip_invalid_applies_the_good_rows_only(self, tmp_path, student):
        out, err = run(tmp_path, [
            f'{student.id},2026-03-02,2026-04-20,ok',
            '999999,2026-03-02,2026-04-20,nobody',
        ], '--apply', '--skip-invalid')
        assert err is None
        assert '1 valid, 1 invalid' in out
        assert EnrollmentBreak.objects.count() == 1

    @pytest.mark.parametrize('row, message', [
        ('{id},2026-04-20,2026-03-02,x', 'end_date must be after start_date'),
        ('{id},2026-03-02,2026-03-02,x', 'end_date must be after start_date'),
        ('{id},03/02/2026,2026-04-20,x', 'start_date must be YYYY-MM-DD'),
        ('{id},2026-03-02,,x', 'end_date must be YYYY-MM-DD'),
        ('abc,2026-03-02,2026-04-20,x', 'student_id'),
        ('{id},1990-01-01,1990-02-01,x', 'implausibly early'),
    ])
    def test_malformed_rows_are_reported(self, tmp_path, student, row, message):
        out, err = run(tmp_path, [row.format(id=student.id)])
        assert err is not None
        assert message in out

    def test_a_future_end_date_is_refused_because_that_is_a_re_admission(self, tmp_path, student):
        future = (date.today() + timedelta(days=5)).isoformat()
        out, err = run(tmp_path, [f'{student.id},2026-03-02,{future},x'])
        assert err is not None and 'use Re-admit' in out

    def test_a_student_of_another_school_is_refused_when_a_school_is_given(self, tmp_path, seed_data, student):
        out, err = run(tmp_path, [f'{student.id},2026-03-02,2026-04-20,x'], '--school-id', str(seed_data['SID_B']))
        assert err is not None
        assert f'belongs to school {student.school_id}, not {seed_data["SID_B"]}' in out


class TestOverlaps:
    def test_a_row_overlapping_a_recorded_break_is_refused(self, tmp_path, seed_data, student):
        EnrollmentBreak.objects.create(school_id=student.school_id, student=student,
                                       start_date=date(2026, 3, 1), end_date=date(2026, 3, 20))
        out, err = run(tmp_path, [f'{student.id},2026-03-10,2026-04-01,x'])
        assert err is not None and 'overlaps a recorded break (2026-03-01 to 2026-03-20)' in out

    def test_a_row_inside_a_still_open_break_is_refused(self, tmp_path, student):
        EnrollmentBreak.objects.create(school_id=student.school_id, student=student, start_date=date(2026, 3, 1))
        out, err = run(tmp_path, [f'{student.id},2026-03-10,2026-04-01,x'])
        assert err is not None and 'still away' in out

    def test_a_row_that_only_touches_a_recorded_break_is_fine(self, tmp_path, student):
        EnrollmentBreak.objects.create(school_id=student.school_id, student=student,
                                       start_date=date(2026, 3, 1), end_date=date(2026, 3, 20))
        out, err = run(tmp_path, [f'{student.id},2026-03-20,2026-04-01,x'])  # starts the day they came back
        assert err is None

    def test_two_rows_of_the_same_file_cannot_overlap(self, tmp_path, student):
        out, err = run(tmp_path, [
            f'{student.id},2026-03-01,2026-03-20,a',
            f'{student.id},2026-03-15,2026-04-01,b',
        ])
        assert err is not None and 'overlaps another row in this file' in out

    def test_separate_periods_for_one_student_are_fine(self, tmp_path, student):
        out, err = run(tmp_path, [
            f'{student.id},2026-03-01,2026-03-20,a',
            f'{student.id},2026-05-01,2026-05-10,b',
        ], '--apply')
        assert err is None and EnrollmentBreak.objects.filter(student=student).count() == 2


class TestFile:
    def test_a_missing_file_is_an_error(self, tmp_path):
        with pytest.raises(CommandError, match='Cannot read'):
            call_command('backfill_enrollment_breaks', '--csv', str(tmp_path / 'nope.csv'))

    def test_missing_columns_are_named(self, tmp_path):
        out, err = run(tmp_path, ['1,2026-03-01'], header='student_id,start_date')
        assert err is not None and 'end_date' in str(err)

    def test_an_empty_file_is_an_error(self, tmp_path):
        out, err = run(tmp_path, [])
        assert err is not None and 'no rows' in str(err)
