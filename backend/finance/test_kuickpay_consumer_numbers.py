"""Consumer-number generation (Kuickpay plan Phase A4)."""
from datetime import date, time

import pytest
from django.test import TestCase

from finance.kuickpay import consumer_numbers as cn
from finance.models import KuickpayBill, KuickpayBiller
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = pytest.mark.kuickpay


def biller(**kw):
    defaults = dict(name='B', prefix='12345', mode='UAT', consumer_number_length=13, check_digit_scheme='NONE')
    defaults.update(kw)
    return KuickpayBiller.objects.create(**defaults)


class TestFormat(TestCase):
    def test_length_must_be_confirmed_before_any_number_is_issued(self):
        with self.assertRaises(cn.ConsumerNumberConfigError):
            cn.format_for_biller(biller(consumer_number_length=None))

    def test_unimplemented_check_digit_scheme_is_refused(self):
        with self.assertRaises(cn.ConsumerNumberConfigError):
            cn.format_for_biller(biller(check_digit_scheme='LUHN'))

    def test_length_beyond_the_column_width_is_refused(self):
        with self.assertRaises(cn.ConsumerNumberConfigError):
            cn.format_for_biller(biller(consumer_number_length=20))

    def test_too_few_reference_digits_is_refused(self):
        with self.assertRaises(cn.ConsumerNumberConfigError):
            cn.format_for_biller(biller(consumer_number_length=9))

    def test_eighteen_and_nineteen_digit_layouts_are_both_supported_by_configuration(self):
        for length in (18, 19):
            fmt = cn.format_for_biller(biller(consumer_number_length=length, mode='PROD' if length == 18 else 'UAT'))
            self.assertEqual(fmt.reference_digits, length - 5)

    def test_validity(self):
        fmt = cn.format_for_biller(biller())
        self.assertTrue(cn.is_valid('1234500000042', fmt))
        for bad in ('123450000004', '12345000000420', '9999900000042', '12345abcdef42', '', None):
            self.assertFalse(cn.is_valid(bad, fmt), bad)


class TestGeneration(TestCase):
    def setUp(self):
        self.biller = biller()
        self.fmt = cn.format_for_biller(self.biller)

    def test_numbers_are_digits_with_the_prefix_and_exact_length(self):
        for number in cn.generate_candidates(self.fmt, 200):
            self.assertTrue(cn.is_valid(number, self.fmt), number)

    def test_leading_zeros_in_the_reference_are_preserved(self):
        numbers = cn.generate_candidates(self.fmt, 1, randbelow=lambda n: 42)
        self.assertEqual(numbers, ['1234500000042'])

    def test_candidates_are_distinct(self):
        values = iter([5, 5, 5, 6, 6, 7])
        numbers = cn.generate_candidates(self.fmt, 3, randbelow=lambda n: next(values))
        self.assertEqual(sorted(numbers), ['1234500000005', '1234500000006', '1234500000007'])

    def test_allocate_returns_the_requested_count_of_unique_valid_numbers(self):
        numbers = cn.allocate(self.biller, 500)
        self.assertEqual(len(numbers), 500)
        self.assertEqual(len(set(numbers)), 500)
        self.assertTrue(all(cn.is_valid(n, self.fmt) for n in numbers))

    def test_allocate_skips_numbers_already_issued(self):
        org = Organization.objects.create(name='O', slug='cn-org')
        school = School.objects.create(organization=org, name='S', subdomain='cn-school')
        student = Student.objects.create(
            school=school, class_obj=Class.objects.create(school=school, name='C', grade_level=1),
            name='X', roll_number='1',
        )
        KuickpayBill.objects.create(
            school=school, biller=self.biller, student=student, student_ref=student.id, year=2026, month=1,
            consumer_number='1234500000001',
        )
        draws = iter([1, 1, 2, 3, 4, 5, 6, 7, 8])
        numbers = cn.allocate(self.biller, 2, randbelow=lambda n: next(draws))
        self.assertNotIn('1234500000001', numbers)
        self.assertEqual(len(numbers), 2)

    def test_allocate_zero_is_empty(self):
        self.assertEqual(cn.allocate(self.biller, 0), [])

    def test_a_crowded_space_is_refused_instead_of_looping(self):
        tiny = biller(prefix='99999', mode='PROD', consumer_number_length=11)   # only 10**6 references
        with self.assertRaises(cn.ConsumerNumberExhausted):
            cn.allocate(tiny, 600000)

    def test_two_billers_with_different_prefixes_never_collide(self):
        other = biller(prefix='54321', mode='PROD')
        a = set(cn.allocate(self.biller, 50))
        b = set(cn.allocate(other, 50))
        self.assertFalse(a & b)
