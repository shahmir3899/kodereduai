# Data migration: create Organization, memberships, link accounts

from django.db import migrations


def populate_forward(apps, schema_editor):
    Organization = apps.get_model('schools', 'Organization')
    School = apps.get_model('schools', 'School')
    User = apps.get_model('users', 'User')
    UserSchoolMembership = apps.get_model('schools', 'UserSchoolMembership')
    Account = apps.get_model('finance', 'Account')

    # 1. Create the organization
    org = Organization.objects.create(
        name='The Focus Montessori',
        slug='focus-montessori',
        is_active=True,
    )

    # 2. Link all existing schools to the org
    School.objects.all().update(organization=org)

    # 3. For each User with a school FK, create a membership
    for user in User.objects.exclude(school__isnull=True):
        UserSchoolMembership.objects.create(
            user=user,
            school=user.school,
            role=user.role if user.role in ('SCHOOL_ADMIN', 'STAFF') else 'SCHOOL_ADMIN',
            is_default=True,
            is_active=True,
        )

    # 4. Set User.organization for all users
    User.objects.all().update(organization=org)

    # 5. Set Account.organization from Account.school.organization
    for account in Account.objects.select_related('school').all():
        if account.school and account.school.organization:
            account.organization = account.school.organization
            account.save(update_fields=['organization'])


def populate_reverse(apps, schema_editor):
    Organization = apps.get_model('schools', 'Organization')
    UserSchoolMembership = apps.get_model('schools', 'UserSchoolMembership')
    User = apps.get_model('users', 'User')
    Account = apps.get_model('finance', 'Account')
    School = apps.get_model('schools', 'School')

    UserSchoolMembership.objects.all().delete()
    User.objects.all().update(organization=None)
    Account.objects.all().update(organization=None)
    School.objects.all().update(organization=None)
    Organization.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0004_organization_school_organization_and_more'),
        ('users', '0002_user_organization_alter_user_school'),
        ('finance', '0006_alter_account_unique_together_account_organization_and_more'),
    ]

    operations = [
        migrations.RunPython(populate_forward, populate_reverse),
    ]
