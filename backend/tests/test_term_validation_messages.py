"""Term form validation messages should name the dates the user has to stay inside."""

from datetime import timedelta

import pytest

from academic_sessions.serializers import TermCreateSerializer


def _errors(school, year, **fields):
    data = {'academic_year': year.id, 'name': 'Probe Term', 'term_type': 'TERM', 'order': 9, **fields}
    serializer = TermCreateSerializer(data=data, context={'school_id': school.id})
    assert not serializer.is_valid()
    return serializer.errors


@pytest.mark.django_db
def test_out_of_range_dates_name_the_academic_year_bounds(seed_data):
    school, year = seed_data['school_a'], seed_data['academic_year']
    errors = _errors(
        school, year,
        start_date=year.start_date - timedelta(days=30), end_date=year.end_date + timedelta(days=30),
    )
    start_day = f'{year.start_date.day} {year.start_date.strftime("%b %Y")}'
    end_day = f'{year.end_date.day} {year.end_date.strftime("%b %Y")}'
    assert start_day in str(errors['start_date'][0])
    assert end_day in str(errors['end_date'][0])


@pytest.mark.django_db
def test_overlap_names_the_clashing_term_and_its_dates(seed_data):
    school, year, term = seed_data['school_a'], seed_data['academic_year'], seed_data['terms'][0]
    errors = _errors(
        school, year,
        start_date=term.start_date + timedelta(days=1), end_date=term.start_date + timedelta(days=10),
    )
    message = str(errors['non_field_errors'][0])
    assert term.name in message
    assert f'{term.start_date.day} {term.start_date.strftime("%b %Y")}' in message
