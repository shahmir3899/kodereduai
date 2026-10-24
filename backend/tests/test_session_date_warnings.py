"""Overlapping or odd dates on years and terms are warnings the admin can confirm, not hard errors."""

from datetime import date, timedelta

import pytest

from academic_sessions.models import AcademicYear
from academic_sessions.serializers import AcademicYearCreateSerializer, TermCreateSerializer


def _term(school, year, **fields):
    data = {'academic_year': year.id, 'name': 'Probe Term', 'term_type': 'TERM', 'order': 9, **fields}
    return TermCreateSerializer(data=data, context={'school_id': school.id})


def _year(school, **fields):
    return AcademicYearCreateSerializer(data=fields, context={'school_id': school.id})


@pytest.mark.django_db
def test_overlapping_term_needs_confirmation_then_saves(seed_data):
    school, year, term = seed_data['school_a'], seed_data['academic_year'], seed_data['terms'][0]
    dates = {'start_date': term.start_date + timedelta(days=1), 'end_date': term.start_date + timedelta(days=10)}

    unconfirmed = _term(school, year, **dates)
    assert not unconfirmed.is_valid()
    assert 'confirm_warnings' in unconfirmed.errors

    confirmed = _term(school, year, confirm_warnings=True, **dates)
    assert confirmed.is_valid(), confirmed.errors
    assert 'confirm_warnings' not in confirmed.validated_data  # never reaches Model.objects.create


@pytest.mark.django_db
def test_confirming_does_not_waive_hard_errors(seed_data):
    school, year = seed_data['school_a'], seed_data['academic_year']
    serializer = _term(
        school, year, confirm_warnings=True,
        start_date=year.start_date - timedelta(days=30), end_date=year.start_date + timedelta(days=5),
    )
    assert not serializer.is_valid()
    assert 'start_date' in serializer.errors


@pytest.mark.django_db
def test_overlapping_year_and_odd_length_are_warnings(seed_data):
    school, year = seed_data['school_a'], seed_data['academic_year']
    overlap = {'name': 'Overlap Year', 'start_date': year.end_date - timedelta(days=30),
               'end_date': year.end_date + timedelta(days=300)}
    assert not _year(school, **overlap).is_valid()
    assert _year(school, confirm_warnings=True, **overlap).is_valid()

    short = {'name': 'Short Year', 'start_date': year.end_date + timedelta(days=10),
             'end_date': year.end_date + timedelta(days=20)}
    errors = _year(school, **short)
    assert not errors.is_valid()
    assert '10 days' in str(errors.errors['non_field_errors'][0])


@pytest.mark.django_db
def test_year_edit_cannot_strand_a_term(seed_data):
    school, year, term = seed_data['school_a'], seed_data['academic_year'], seed_data['terms'][0]
    serializer = AcademicYearCreateSerializer(
        year, data={'name': year.name, 'start_date': term.start_date + timedelta(days=5), 'end_date': year.end_date,
                    'confirm_warnings': True},
        context={'school_id': school.id},
    )
    assert not serializer.is_valid()
    assert term.name in str(serializer.errors['end_date'][0])
