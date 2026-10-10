"""backfill_enrollment_placements gives enrollments without a placement their initial one, once."""
from io import StringIO

import pytest
from django.core.management import call_command

from academic_sessions.models import EnrollmentPlacement, StudentEnrollment


@pytest.mark.django_db
def test_backfill_is_idempotent_and_dry_run_changes_nothing(seed_sections):
    # Enrollments made by code that predates placements have none.
    EnrollmentPlacement.objects.all().delete()
    total = StudentEnrollment.objects.count()
    assert total > 0

    out = StringIO()
    call_command('backfill_enrollment_placements', '--dry-run', stdout=out)
    assert f'would create {total}' in out.getvalue()
    assert EnrollmentPlacement.objects.count() == 0

    out = StringIO()
    call_command('backfill_enrollment_placements', stdout=out)
    assert f'created {total}' in out.getvalue()
    assert EnrollmentPlacement.objects.count() == total

    out = StringIO()
    call_command('backfill_enrollment_placements', stdout=out)
    assert 'created 0' in out.getvalue()
    assert EnrollmentPlacement.objects.count() == total
