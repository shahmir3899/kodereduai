from django.db import migrations


def forward(apps, schema_editor):
    """
    For every school that has MONTHLY FeeStructure or FeePayment rows,
    create a default 'Monthly Fee' MonthlyFeeCategory and assign it to
    every MONTHLY row that currently has monthly_category=None.
    """
    MonthlyFeeCategory = apps.get_model('finance', 'MonthlyFeeCategory')
    FeeStructure = apps.get_model('finance', 'FeeStructure')
    FeePayment = apps.get_model('finance', 'FeePayment')

    # Collect all school IDs that have MONTHLY records
    school_ids_from_structures = (
        FeeStructure.objects.filter(fee_type='MONTHLY', monthly_category__isnull=True)
        .values_list('school_id', flat=True)
        .distinct()
    )
    school_ids_from_payments = (
        FeePayment.objects.filter(fee_type='MONTHLY', monthly_category__isnull=True)
        .values_list('school_id', flat=True)
        .distinct()
    )
    school_ids = set(school_ids_from_structures) | set(school_ids_from_payments)

    for school_id in school_ids:
        cat, _ = MonthlyFeeCategory.objects.get_or_create(
            school_id=school_id,
            name='Tuition Fee',
            defaults={'description': 'Default monthly tuition charge', 'is_active': True},
        )
        FeeStructure.objects.filter(
            fee_type='MONTHLY', school_id=school_id, monthly_category__isnull=True
        ).update(monthly_category=cat)
        FeePayment.objects.filter(
            fee_type='MONTHLY', school_id=school_id, monthly_category__isnull=True
        ).update(monthly_category=cat)


def backward(apps, schema_editor):
    """
    Null out monthly_category on all MONTHLY rows and remove the
    default 'Monthly Fee' categories created during the forward migration.
    """
    MonthlyFeeCategory = apps.get_model('finance', 'MonthlyFeeCategory')
    FeeStructure = apps.get_model('finance', 'FeeStructure')
    FeePayment = apps.get_model('finance', 'FeePayment')

    FeeStructure.objects.filter(fee_type='MONTHLY').update(monthly_category=None)
    FeePayment.objects.filter(fee_type='MONTHLY').update(monthly_category=None)
    MonthlyFeeCategory.objects.filter(name__in=['Monthly Fee', 'Tuition Fee']).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0023_add_monthly_fee_category'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
