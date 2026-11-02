"""Kuickpay admin pages: setup records editable and validated, audit records read-only."""
import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from finance.models import (
    Account, KuickpayBiller, KuickpayBill, KuickpayCallbackLog, KuickpayPaymentAllocation,
    KuickpaySchoolMapping, KuickpayTransaction,
)
from schools.models import Organization, School

pytestmark = pytest.mark.kuickpay


# Admin pages reference static files; the test run has no collected (manifest) static files.
@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class TestKuickpayAdmin(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='AdminOrg', slug='adm-org')
        cls.school = School.objects.create(
            organization=org, name='Admin School', subdomain='adm-school',
            contact_email='office@adm.pk', contact_phone='03001234567',
        )
        cls.bank = Account.objects.create(school=cls.school, name='Bank', account_type='BANK')
        cls.biller = KuickpayBiller.objects.create(name='B', prefix='12345', mode='UAT', consumer_number_length=12)
        cls.admin = get_user_model().objects.create_superuser('adm_root', 'adm@test.com', 'pw12345678')

    def setUp(self):
        self.client = Client()
        self.client.force_login(self.admin)

    def test_django_system_checks_pass(self):
        # A bad admin option fails the startup checks, which would break `migrate` on deploy.
        from django.core.management import call_command
        call_command('check', verbosity=0)

    def test_every_kuickpay_model_is_registered(self):
        for model in (KuickpayBiller, KuickpaySchoolMapping, KuickpayBill, KuickpayTransaction,
                      KuickpayPaymentAllocation, KuickpayCallbackLog):
            self.assertIn(model, admin.site._registry)

    def test_setup_pages_load(self):
        for name in ('kuickpaybiller', 'kuickpayschoolmapping'):
            self.assertEqual(self.client.get(f'/admin/finance/{name}/').status_code, 200)
            self.assertEqual(self.client.get(f'/admin/finance/{name}/add/').status_code, 200)

    def test_audit_records_cannot_be_added_changed_or_deleted(self):
        for model in (KuickpayBill, KuickpayTransaction, KuickpayPaymentAllocation, KuickpayCallbackLog):
            ma = admin.site._registry[model]
            request = type('R', (), {'user': self.admin})()
            self.assertFalse(ma.has_add_permission(request))
            self.assertFalse(ma.has_change_permission(request))
            self.assertFalse(ma.has_delete_permission(request))

    def test_an_administrator_can_create_a_valid_mapping_through_the_admin(self):
        response = self.client.post('/admin/finance/kuickpayschoolmapping/add/', {
            'school': self.school.pk, 'biller': self.biller.pk, 'settlement_account': self.bank.pk,
            'due_day': 10, 'is_enabled': 'on',
        })
        self.assertEqual(response.status_code, 302)
        self.assertTrue(KuickpaySchoolMapping.objects.filter(school=self.school, is_enabled=True).exists())

    def test_the_admin_refuses_to_enable_a_school_without_valid_contact_details(self):
        School.objects.filter(pk=self.school.pk).update(contact_email='', contact_phone='')
        response = self.client.post('/admin/finance/kuickpayschoolmapping/add/', {
            'school': self.school.pk, 'biller': self.biller.pk, 'settlement_account': self.bank.pk,
            'due_day': 10, 'is_enabled': 'on',
        })
        self.assertEqual(response.status_code, 200)                       # form redisplayed with errors
        self.assertFalse(KuickpaySchoolMapping.objects.exists())

    def test_the_admin_refuses_a_non_bank_account(self):
        cash = Account.objects.create(school=self.school, name='Cash', account_type='CASH')
        response = self.client.post('/admin/finance/kuickpayschoolmapping/add/', {
            'school': self.school.pk, 'biller': self.biller.pk, 'settlement_account': cash.pk, 'due_day': 10,
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(KuickpaySchoolMapping.objects.exists())
